"""The EPUB container: zip → OPF package → metadata, reading order and table of contents.

    META-INF/container.xml  → the OPF path
    OPF <metadata>          → title, creators, date, language
    OPF <manifest>/<spine>  → content documents in reading order (linear and not)
    nav (EPUB 3) / NCX (2)  → `TocEntry`s pointing at `document#fragment`

Every path is a zip member name (`OEBPS/text/ch01.xhtml`): hrefs are resolved against
the document that holds them and percent-decoded. Nothing is extracted to disk.
"""

import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit

from lxml import etree

from app.pipeline.parse.anchors import normalize_text
from app.pipeline.parse.dom import (
    Element,
    attr,
    children,
    local_name,
    parse_html,
    parse_xml,
    text_of,
)
from app.pipeline.parse.model import ParseError

MAX_MEMBER_BYTES = 128 * 1024 * 1024  # a single chapter or image; guards against zip bombs
CONTENT_TYPES = frozenset({"application/xhtml+xml", "text/html"})
_NCX_TYPE = "application/x-dtbncx+xml"
_YEAR = re.compile(r"\b(\d{4})\b")
# Font obfuscation (IDPF / Adobe) is not DRM: those fonts are never read anyway.
_FONT_OBFUSCATION = ("http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC")


@dataclass(frozen=True, slots=True)
class TocEntry:
    depth: int  # 1 = top level
    title: str
    path: str  # zip member
    fragment: str | None


@dataclass(slots=True)
class Package:
    archive: zipfile.ZipFile
    title: str | None = None
    creators: list[str] = field(default_factory=list)
    year: int | None = None
    language: str | None = None
    spine: list[str] = field(default_factory=list)  # linear content documents, in order
    auxiliary: list[str] = field(default_factory=list)  # non-linear ones (endnotes, popups)
    toc: list[TocEntry] = field(default_factory=list)
    nav: str | None = None  # the EPUB 3 navigation document, never read as content
    cover: str | None = None  # the cover image, never turned into a figure
    media_types: dict[str, str] = field(default_factory=dict)

    def read(self, path: str) -> bytes:
        try:
            info = self.archive.getinfo(path)
        except KeyError:
            raise ParseError(f"missing from the EPUB: {path}") from None
        if info.file_size > MAX_MEMBER_BYTES:
            raise ParseError(f"{path} is too large ({info.file_size} bytes)")
        return self.archive.read(info)

    def has(self, path: str) -> bool:
        return path in self.archive.NameToInfo


def resolve(base: str, href: str) -> tuple[str, str | None]:
    """`href` as written in the document `base` → `(zip path, fragment or None)`."""
    parts = urlsplit(href)
    if parts.scheme or parts.netloc:
        return "", None  # external link
    target = unquote(parts.path)
    path = posixpath.normpath(posixpath.join(posixpath.dirname(base), target)) if target else base
    return path.lstrip("/"), unquote(parts.fragment) or None


def _xml(package: Package, path: str) -> Element:
    try:
        return parse_xml(package.read(path))
    except etree.XMLSyntaxError as exc:
        raise ParseError(f"unreadable {path}: {exc}") from exc


def _find(root: Element, name: str) -> list[Element]:
    return [el for el in root.iter() if local_name(el) == name]


def _check_drm(package: Package) -> None:
    if not package.has("META-INF/encryption.xml"):
        return
    root = _xml(package, "META-INF/encryption.xml")
    for data in _find(root, "encrypteddata"):
        methods = [attr(m, "algorithm") for m in _find(data, "encryptionmethod")]
        if not all(m.startswith(_FONT_OBFUSCATION) for m in methods):
            raise ParseError("the EPUB is DRM-protected")


def _opf_path(package: Package) -> str:
    root = _xml(package, "META-INF/container.xml")
    for rootfile in _find(root, "rootfile"):
        if path := attr(rootfile, "full-path"):
            return path
    raise ParseError("META-INF/container.xml names no package document")


def _metadata(package: Package, opf: Element) -> None:
    def texts(name: str) -> list[str]:
        return [t for el in _find(opf, name) if (t := normalize_text(text_of(el)))]

    titles = texts("title")
    package.title = titles[0] if titles else None
    package.creators = texts("creator")
    for date in texts("date"):
        if year := _YEAR.search(date):
            package.year = int(year.group(1))
            break
    languages = texts("language")
    package.language = languages[0].split("-")[0].lower() if languages else None


def _manifest(package: Package, opf_path: str, opf: Element) -> dict[str, tuple[str, str]]:
    """`id → (zip path, properties)`; also fills media types, nav, NCX-free cover."""
    items: dict[str, tuple[str, str]] = {}
    for item in _find(opf, "item"):
        path, _ = resolve(opf_path, attr(item, "href"))
        properties = attr(item, "properties").split()
        items[attr(item, "id")] = (path, " ".join(properties))
        package.media_types[path] = attr(item, "media-type").lower()
        if "nav" in properties:
            package.nav = path
        if "cover-image" in properties:
            package.cover = path
    if package.cover is None:  # EPUB 2: <meta name="cover" content="item-id"/>
        for meta in _find(opf, "meta"):
            if attr(meta, "name") != "cover" or not (content := attr(meta, "content")):
                continue
            if content in items:
                package.cover = items[content][0]
            # Some tools write the image's path instead of its id, even for an unlisted file.
            elif package.has(path := resolve(opf_path, content)[0]):
                package.cover = path
    return items


def _spine(package: Package, opf: Element, items: dict[str, tuple[str, str]]) -> str | None:
    """Fill the reading order; returns the NCX path the spine names (EPUB 2)."""
    spines = _find(opf, "spine")
    if not spines:
        raise ParseError("the package document has no spine")
    for ref in _find(spines[0], "itemref"):
        path = items.get(attr(ref, "idref"), ("", ""))[0]
        if package.media_types.get(path) not in CONTENT_TYPES or path == package.nav:
            continue
        (package.auxiliary if attr(ref, "linear") == "no" else package.spine).append(path)
    ncx = items.get(attr(spines[0], "toc"), ("", ""))[0]
    if not ncx:
        ncx = next((p for p, t in package.media_types.items() if t == _NCX_TYPE), "")
    return ncx or None


def _nav_entries(package: Package, nav_path: str) -> list[TocEntry]:
    root = parse_html(package.read(nav_path))
    navs = _find(root, "nav")
    toc = next((n for n in navs if "toc" in attr(n, "type").split()), navs[0] if navs else None)
    if toc is None:
        return []
    entries: list[TocEntry] = []

    def walk(ol: Element, depth: int) -> None:
        for li in children(ol):
            if local_name(li) != "li":
                continue
            link = next((c for c in li.iter() if local_name(c) in ("a", "span")), None)
            if link is not None and local_name(link) == "a":
                title = normalize_text(text_of(link))
                path, fragment = resolve(nav_path, attr(link, "href"))
                if title and path:
                    entries.append(TocEntry(depth, title, path, fragment))
            for sub in children(li):
                if local_name(sub) in ("ol", "ul"):
                    walk(sub, depth + 1)

    for ol in children(toc):
        if local_name(ol) in ("ol", "ul"):
            walk(ol, 1)
    return entries


def _ncx_entries(package: Package, ncx_path: str) -> list[TocEntry]:
    entries: list[TocEntry] = []

    def walk(parent: Element, depth: int) -> None:
        for point in children(parent):
            if local_name(point) != "navpoint":
                continue
            label = next((el for el in point.iter() if local_name(el) == "text"), None)
            content = next((el for el in children(point) if local_name(el) == "content"), None)
            title = normalize_text(text_of(label)) if label is not None else ""
            if title and content is not None:
                path, fragment = resolve(ncx_path, attr(content, "src"))
                if path:
                    entries.append(TocEntry(depth, title, path, fragment))
            walk(point, depth + 1)

    for nav_map in _find(_xml(package, ncx_path), "navmap"):
        walk(nav_map, 1)
    return entries


def open_package(path: Path) -> Package:
    """Read an EPUB's package; raises `ParseError` for anything that is not a usable EPUB.

    The caller owns `package.archive` and closes it.
    """
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise ParseError(f"cannot open EPUB {path.name}: {exc}") from exc
    package = Package(archive=archive)
    try:
        _check_drm(package)
        opf_path = _opf_path(package)
        opf = _xml(package, opf_path)
        _metadata(package, opf)
        items = _manifest(package, opf_path, opf)
        ncx = _spine(package, opf, items)
        if not package.spine:
            raise ParseError(f"{path.name} has no readable content documents")
        if package.nav and package.has(package.nav):
            package.toc = _nav_entries(package, package.nav)
        if not package.toc and ncx and package.has(ncx):
            package.toc = _ncx_entries(package, ncx)
    except BaseException:
        archive.close()
        raise
    return package
