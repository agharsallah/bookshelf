"""HTML articles and Markdown end in the same tree and block kinds as PDFs."""

import pytest

from app.models.enums import NodeKind
from app.pipeline.parse import ParsedDocument, ParseError
from app.pipeline.parse.html import parse_html
from app.pipeline.parse.markdown import parse_markdown

ARTICLE = """<html><head><title>Leverage Points</title>
<meta name="author" content="Donella Meadows"><meta name="date" content="1999-06-01"></head>
<body><nav>Home | About | Subscribe</nav><article><h1>Leverage Points</h1>
<p>Folks who do systems analysis have a great belief in leverage points in a system.</p>
<h2>Numbers</h2><p>Constants and parameters are the least effective place to intervene.</p>
<figure><img src="https://example.org/tub.png" alt="tub">
<figcaption>Figure 1: The bathtub</figcaption></figure>
<pre><code class="language-go">rate := stock / time</code></pre>
<table><tr><th>Point</th><th>Rank</th></tr><tr><td>Paradigms</td><td>2</td></tr></table>
<p>The flow is \\(dS/dt\\) and <math><mi>x</mi><mo>=</mo><mn>1</mn></math> here.</p>
<math display="block"><semantics><mi>S</mi>
<annotation encoding="application/x-tex">S = \\int f\\,dt</annotation></semantics></math>
<h3>Buffers</h3><ul><li>big buffers stabilise</li><li>small ones react</li></ul>
<blockquote>Magical leverage points are not easily accessible.</blockquote>
</article><footer>Copyright notice</footer></body></html>"""

NOTES = """---
title: Notes on Loops
authors: [Ann Lee, Bo Chen]
date: 2020-05-01
---
# Notes on Loops

Written before the first chapter.

## Stocks

A stock is a store. It
continues on the next line.

```python
def f():
    return 1
```

| Stock | Unit |
|-------|------|
| Water | l    |

$$
E = mc^2
$$

![A bathtub](img/tub.png "Figure 1 A bathtub")

> [!WARNING]
> Mind the drain.

### Flows

1. first
2. second

## Loops

> Loops close on themselves.
"""


def _shape(parsed: ParsedDocument) -> list[tuple[str, str]]:
    return [(n.anchor, n.kind.value) for n in parsed.walk()]


def _one(parsed: ParsedDocument, kind: NodeKind):
    [node] = [n for n in parsed.walk() if n.kind is kind]
    return node


@pytest.fixture(scope="module")
def article() -> ParsedDocument:
    return parse_html(ARTICLE)


@pytest.fixture(scope="module")
def notes() -> ParsedDocument:
    return parse_markdown(NOTES)


def test_html_article_is_one_chapter_with_h2_sections_and_h3_subsections(article):
    assert (article.title, article.authors, article.year) == (
        "Leverage Points", ["Donella Meadows"], 1999
    )  # fmt: skip
    assert _shape(article) == [
        ("ch01", "chapter"),
        ("ch01/p001", "paragraph"),
        ("ch01/s01", "section"),
        ("ch01/s01/p001", "paragraph"),
        ("ch01/s01/f001", "figure"),
        ("ch01/s01/c001", "code"),
        ("ch01/s01/t001", "table"),
        ("ch01/s01/p002", "paragraph"),
        ("ch01/s01/m001", "math"),
        ("ch01/s01/ss01", "section"),
        ("ch01/s01/ss01/l001", "list"),
        ("ch01/s01/ss01/q001", "quote"),
    ]
    assert "Subscribe" not in " ".join(n.text or "" for n in article.walk())


def test_html_keeps_figcaption_code_language_table_and_math(article):
    figure = _one(article, NodeKind.FIGURE)
    assert (figure.meta["src"], figure.meta["caption"]) == (
        "https://example.org/tub.png", "Figure 1: The bathtub"
    )  # fmt: skip
    code = _one(article, NodeKind.CODE)
    assert (code.text, code.meta["language"]) == ("rate := stock / time", "go")
    assert _one(article, NodeKind.TABLE).meta["table"] == {
        "header": ["Point", "Rank"],
        "rows": [["Paradigms", "2"]],
    }
    math = _one(article, NodeKind.MATH)
    assert (math.meta["latex"], math.meta["inline"]) == (r"S = \int f\,dt", False)
    inline = next(n for n in article.walk() if "flow is" in (n.text or ""))
    assert inline.text == r"The flow is \(dS/dt\) and \(x=1\) here."


def test_html_without_article_content_is_a_parse_error():
    with pytest.raises(ParseError):
        parse_html("<html><body></body></html>")


def test_markdown_headings_become_the_tree_and_front_matter_the_metadata(notes):
    assert (notes.title, notes.authors, notes.year) == (
        "Notes on Loops", ["Ann Lee", "Bo Chen"], 2020
    )  # fmt: skip
    assert _shape(notes) == [
        ("fm01", "chapter"),
        ("fm01/p001", "paragraph"),
        ("ch01", "chapter"),
        ("ch01/p001", "paragraph"),
        ("ch01/c001", "code"),
        ("ch01/t001", "table"),
        ("ch01/m001", "math"),
        ("ch01/f001", "figure"),
        ("ch01/a001", "aside"),
        ("ch01/s01", "section"),
        ("ch01/s01/l001", "list"),
        ("ch02", "chapter"),
        ("ch02/q001", "quote"),
    ]


def test_markdown_blocks_keep_their_structure(notes):
    assert _one(notes, NodeKind.CODE).text == "def f():\n    return 1"
    assert _one(notes, NodeKind.CODE).meta["language"] == "python"
    assert _one(notes, NodeKind.TABLE).meta["table"] == {
        "header": ["Stock", "Unit"],
        "rows": [["Water", "l"]],
    }
    assert _one(notes, NodeKind.MATH).meta["latex"] == "E = mc^2"
    figure = _one(notes, NodeKind.FIGURE)
    assert (figure.meta["src"], figure.meta["caption"]) == ("img/tub.png", "Figure 1 A bathtub")
    aside = _one(notes, NodeKind.ASIDE)
    assert (aside.text, aside.meta["label"]) == ("Mind the drain.", "Warning")
    assert _one(notes, NodeKind.LIST).meta == {"items": ["first", "second"], "ordered": True}
    assert (
        notes.children[1].children[0].text == "A stock is a store. It continues on the next line."
    )


def test_markdown_without_headings_is_a_single_chapter():
    parsed = parse_markdown("Just one paragraph.\n")

    assert _shape(parsed) == [("ch01", "chapter"), ("ch01/p001", "paragraph")]
