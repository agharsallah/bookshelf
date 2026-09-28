"""Fixture EPUBs built with `zipfile`: small, deterministic, written in milliseconds.

`book_epub()` is an EPUB 3 book exercising every block kind:

    cover.xhtml     the cover image alone (never a figure)
    ch1.xhtml       `Chapter 1 Stocks` (nav → file) · a paragraph citing footnote 1 · a
                    page break (12) · `1.1 Flows` (nav → #flows) · Python code · a list ·
                    a table with a header row · a figure (PNG + caption) · display MathML ·
                    an `<h3>` missing from the nav · the footnote body · a `<nav>` bar
    ch2.xhtml       `Chapter 2 Loops` (label and title in two headings) · a blockquote ·
                    an aside with a heading · an inline SVG figure · inline MathML

`epub2_book()` has an NCX instead of a nav document and an endnotes file outside the
linear reading order; `untitled_book()` has no table of contents at all.
"""

# mypy: disallow-untyped-calls=False

import zipfile
from pathlib import Path

import pymupdf

CODE = "def flow(stock):\n    return stock * 0.5"
XHTML = "http://www.w3.org/1999/xhtml"
EPUB_NS = "http://www.idpf.org/2007/ops"
MATHML = "http://www.w3.org/1998/Math/MathML"
CONTAINER = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf"
    media-type="application/oebps-package+xml"/></rootfiles>
</container>"""


def png() -> bytes:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 8, 8), False)
    pixmap.clear_with(120)
    return bytes(pixmap.tobytes("png"))


def page(body: str, title: str = "Book") -> str:
    return (
        f'<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="{XHTML}" '
        f'xmlns:epub="{EPUB_NS}"><head><title>{title}</title></head><body>{body}</body></html>'
    )


def write_epub(path: Path, files: dict[str, str | bytes]) -> Path:
    """`mimetype` first and stored, as the OCF spec wants; then the rest."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        archive.writestr("META-INF/container.xml", CONTAINER)
        for name, data in files.items():
            archive.writestr(name, data)
    return path


def opf(metadata: str, manifest: str, spine: str, *, toc: str = "") -> str:
    return f"""<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"
  version="3.0" unique-identifier="id">
  <metadata>{metadata}</metadata>
  <manifest>{manifest}</manifest>
  <spine{f' toc="{toc}"' if toc else ""}>{spine}</spine>
</package>"""


CH1 = page(f"""
<nav class="header"><p>Next: Chapter 2 | Contents</p></nav>
<h1>Chapter 1 Stocks</h1>
<p>A stock is the memory of a system.<a epub:type="noteref" href="#fn1" id="r1"><sup>1</sup></a>
It changes only through flows.</p>
<span epub:type="pagebreak" id="p12" title="12"/>
<h2 id="flows">1.1 Flows</h2>
<pre><code class="language-python">{CODE}</code></pre>
<ul><li>inflows fill the stock</li><li>outflows drain the stock</li></ul>
<table><thead><tr><th>Name</th><th>Kind</th></tr></thead>
<tbody><tr><td>Bathtub</td><td>stock</td></tr><tr><td>Faucet</td><td>flow</td></tr></tbody></table>
<figure><img src="images/tub.png" alt="a bathtub"/><figcaption>Figure 1.1 The bathtub</figcaption>
</figure>
<math xmlns="{MATHML}" display="block"><mfrac><mi>dS</mi><mi>dt</mi></mfrac><mo>=</mo>
<msup><mi>x</mi><mn>2</mn></msup></math>
<h3>Delays</h3>
<p>Delays make stocks oscillate.</p>
<aside epub:type="footnote" id="fn1"><p><a href="#r1">1</a> Meadows calls it a buffer.</p></aside>
""")

CH2 = page(f"""
<section><h1 class="label">Chapter 2</h1><h1>Loops</h1>
<blockquote><p>Feedback is everywhere.</p></blockquote>
<aside><h4>Key idea</h4><p>Balancing loops seek a goal.</p></aside>
<div><svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20"
height="10" fill="red"/></svg></div>
<p>The rate is <math xmlns="{MATHML}"><msqrt><mi>k</mi></msqrt></math> per year.</p>
</section>
""")

NAV = page("""
<nav epub:type="toc"><ol>
  <li><a href="ch1.xhtml">Chapter 1 Stocks</a>
    <ol><li><a href="ch1.xhtml#flows">1.1 Flows</a></li></ol></li>
  <li><a href="ch2.xhtml">Chapter 2 Loops</a></li>
</ol></nav>
<nav epub:type="landmarks"><ol><li><a href="ch1.xhtml">Start</a></li></ol></nav>
""")


def book_epub(path: Path) -> Path:
    manifest = """
      <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
      <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
      <item id="cover-img" href="images/cover.png" properties="cover-image"
        media-type="image/png"/>
      <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
      <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      <item id="tub" href="images/tub.png" media-type="image/png"/>"""
    spine = '<itemref idref="cover"/><itemref idref="ch1"/><itemref idref="ch2"/>'
    metadata = """<dc:title>Thinking in Systems</dc:title><dc:creator>Meadows, Donella</dc:creator>
      <dc:date>2008-12-03</dc:date><dc:language>en-US</dc:language>"""
    return write_epub(path, {
        "OEBPS/content.opf": opf(metadata, manifest, spine),
        "OEBPS/nav.xhtml": NAV,
        "OEBPS/cover.xhtml": page('<div><img src="images/cover.png" alt="cover"/></div>'),
        "OEBPS/ch1.xhtml": CH1,
        "OEBPS/ch2.xhtml": CH2,
        "OEBPS/images/tub.png": png(),
        "OEBPS/images/cover.png": png(),
    })  # fmt: skip


def epub2_book(path: Path) -> Path:
    """NCX table of contents; endnotes in a non-linear document, cited from chapter 1."""
    manifest = """
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="one" href="text/one.html" media-type="application/xhtml+xml"/>
      <item id="notes" href="text/notes.html" media-type="application/xhtml+xml"/>"""
    spine = '<itemref idref="one"/><itemref idref="notes" linear="no"/>'
    ncx = """<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
  <navPoint id="n1"><navLabel><text>Part I Foundations</text></navLabel>
    <content src="text/one.html"/>
    <navPoint id="n2"><navLabel><text>The Basics</text></navLabel>
      <content src="text/one.html#basics"/></navPoint>
  </navPoint>
</navMap></ncx>"""
    one = page("""<h1>Part I Foundations</h1><p>Opening words&nbsp;for the part.</p>
<h2 id="basics">The Basics</h2>
<p>Everything starts here.<a class="noteref" href="notes.html#en1">[1]</a></p>""")
    notes = page('<ol><li id="en1"><a href="one.html">↩</a> From the 1972 report.</li></ol>')
    return write_epub(path, {
        "OEBPS/content.opf": opf("<dc:title>Limits</dc:title>", manifest, spine, toc="ncx"),
        "OEBPS/toc.ncx": ncx,
        "OEBPS/text/one.html": one,
        "OEBPS/text/notes.html": notes,
    })  # fmt: skip


def untitled_book(path: Path) -> Path:
    """No nav, no NCX: headings by rank."""
    manifest = '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>'
    body = page("""<h1>Stocks</h1><p>A stock.</p><h2>Flows</h2><p>A flow.</p>
<h1>Loops</h1><p>A loop.</p>""")
    return write_epub(path, {
        "OEBPS/content.opf": opf("<dc:title>Notes</dc:title>", manifest, '<itemref idref="a"/>'),
        "OEBPS/a.xhtml": body,
    })  # fmt: skip
