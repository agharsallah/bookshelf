"""lxml helpers shared by the parsers that read markup trees (EPUB, MathML).

Two parsers, both hardened: no entity expansion, no DTD loading, no network. Tags are
compared by local name, so `<m:mi>`, `<mi>` and `{…MathML}mi` read alike whichever
parser (HTML or XML) built the tree.
"""

import re

from lxml import etree, html

from app.pipeline.parse.model import ParseError

_XML_PARSER = etree.XMLParser(
    resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False, recover=True
)
_HTML_PARSER = html.HTMLParser(no_network=True, remove_comments=True, remove_pis=True)
_XML_DECLARATION = re.compile(r"^\s*<\?xml[^>]*\?>")

Element = etree._Element  # the one lxml type the parsers see


def local_name(el: Element) -> str:
    """`{ns}p`, `epub:p` and `p` all → `p`; comments and PIs → ``."""
    tag = el.tag
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1].lower()


def attr(el: Element, name: str) -> str:
    """An attribute by lowercase local name (`epub:type`, `{ns}Algorithm` → `type`, …)."""
    for key, value in el.attrib.items():
        if str(key).rsplit("}", 1)[-1].rsplit(":", 1)[-1].lower() == name:
            return str(value)
    return ""


def text_of(el: Element) -> str:
    """All text inside `el`, as written (no normalisation)."""
    return "".join(str(t) for t in el.itertext())


def children(el: Element) -> list[Element]:
    """Element children only (no comments or processing instructions)."""
    return [c for c in el if isinstance(c.tag, str)]


def decode(data: bytes) -> str:
    """EPUB documents are UTF-8 or UTF-16 (BOM); the XML declaration is dropped for lxml."""
    text = data.decode("utf-16") if data[:2] in (b"\xff\xfe", b"\xfe\xff") else None
    text = text if text is not None else data.decode("utf-8-sig", errors="replace")
    return _XML_DECLARATION.sub("", text, count=1)


def parse_xml(data: bytes) -> Element:
    """Package documents (container, OPF, NCX). Raises `ParseError` / `etree.XMLSyntaxError`."""
    root = etree.fromstring(data, parser=_XML_PARSER)
    if root is None:  # `recover=True` returns None for input with no element at all
        raise ParseError("empty XML document")
    return root


def parse_html(data: bytes) -> Element:
    """Content documents: XHTML read leniently, so named entities and tag soup still parse."""
    return html.document_fromstring(decode(data), parser=_HTML_PARSER)
