"""A two-page scientific paper generated with PyMuPDF: small, deterministic, milliseconds.

page 1  arXiv stamp · title (18pt bold) · authors · `Abstract` + paragraph ·
        `1 Introduction` citing [1] and [2, 3] · `2 Method` · `2.1 Setup` citing [1-3]
page 2  `3 Results` · `4 Conclusion` · run-in `Acknowledgements We thank …` ·
        `References` with three [n] entries, each wrapped onto an indented second line
"""

# mypy: disallow-untyped-calls=False

from pathlib import Path

import pymupdf

TITLE = "Tiny Transformers Work"
AUTHORS = ["Ada Lovelace", "Alan Turing"]
ARXIV_ID = "2101.00001"
FILLER = "The model reads every token of the input and the output sequence in parallel"
REFERENCES = [
    (
        "[1] Ada Lovelace and Alan Turing. A first engine paper. In Proceedings of",
        "Engines, pages 1-9, 2017.",
    ),
    (
        "[2] Ashish Vaswani and Noam Shazeer. Attention is all you need. arXiv",
        "preprint arXiv:1706.03762, 2017.",
    ),
    (
        "[3] Grace Hopper. Compilers for everyone. Journal of Code, 3(1):1-5, 2019.",
        "doi:10.1145/123.456.",
    ),
]


def _text(page: pymupdf.Page, x: float, y: float, text: str, size: float = 10, **kw) -> None:
    page.insert_text((x, y), text, fontsize=size, **kw)


def _heading(page: pymupdf.Page, y: float, text: str, size: float = 12) -> None:
    _text(page, 72, y, text, size, fontname="hebo")


def _paragraph(page: pymupdf.Page, y: float, lines: list[str]) -> float:
    for i, line in enumerate(lines):
        _text(page, 72, y + 12 * i, line)
    return y + 12 * len(lines) + 14


def paper_pdf(path: Path) -> Path:
    doc = pymupdf.open()
    one = doc.new_page()  # A4: 595 x 842
    _text(one, 72, 30, f"arXiv:{ARXIV_ID}v2 [cs.CL] 1 Jan 2021", 8)
    _text(one, 150, 80, TITLE, 18, fontname="hebo")
    _text(one, 200, 105, ", ".join(AUTHORS), 11)
    _text(one, 200, 118, "ada@example.org", 9)
    _heading(one, 150, "Abstract")
    y = _paragraph(one, 168, [f"{FILLER}, so training is fast.", "We show tiny models work."])
    _heading(one, y, "1 Introduction")
    y = _paragraph(
        one, y + 18, [f"{FILLER} [1]. Earlier engines [2, 3] were slow and", "sequential."]
    )
    _heading(one, y, "2 Method")
    y = _paragraph(one, y + 18, [f"{FILLER}.", "Nothing else is needed here at all."])
    _heading(one, y, "2.1 Setup", 10.5)
    _paragraph(one, y + 16, [f"We follow the usual recipe [1-3] and {FILLER.lower()}."])

    two = doc.new_page()
    _heading(two, 72, "3 Results")
    y = _paragraph(two, 90, [f"{FILLER}, and scores rise.", "Tiny models win on every benchmark."])
    _heading(two, y, "4 Conclusion")
    y = _paragraph(two, y + 18, [f"{FILLER}.", "Tiny transformers work."])
    y = _paragraph(
        two, y, ["Acknowledgements We thank the engine room for their patience", "and tea."]
    )
    _heading(two, y, "References")
    y += 18
    for first, rest in REFERENCES:
        _text(two, 72, y, first, 9)
        _text(two, 86, y + 11, rest, 9)
        y += 28
    doc.save(path)
    doc.close()
    return path
