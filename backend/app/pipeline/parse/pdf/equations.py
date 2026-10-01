"""Display equations MuPDF cut into pieces, glued back into one block per formula.

To MuPDF a typeset display formula is many text blocks: each big operator, a fraction's
numerator and denominator, the sub- and superscripts, the stretched delimiters and the
equation number come out apart (DeepSeek-R1's GRPO objective is 16 of them). Read one by
one they become a dozen leaves of glyph soup — math, paragraphs, even quotes — and no
single crop shows the formula, so `describe-math` can only guess at fragments.

Here the pieces of one formula are clustered by geometry, closest pair first: two
formula-like blocks join when they sit within half a line of each other vertically and
less than a line apart horizontally. A cluster becomes one block when it holds math-font
text and few words (a table of short cells is not a formula); two numbered equations
never join, so stacked equations stay apart.
"""

import re
from itertools import combinations

from app.pipeline.parse.pdf.layout import Block, Line

EQUATION_NO = re.compile(r"\s*\((\d+(?:\.\d+)*)\)\s*$")
_NUMBER_ONLY = re.compile(r"^\W*\(\d+(?:\.\d+)*\)$")  # `(1)`, `, (2)`: the number set apart
_WORD = re.compile(r"[A-Za-z]{4,}")  # math italics are Unicode letters, not ASCII
_MAX_WORDS = 3  # `clip`, `mean`, `otherwise`: a formula prints few words; prose prints many
_MAX_FORMULA_WORDS = 5  # ... and so does a whole formula (`increase likelihood of y_w`)
_MAX_CHARS = 300
# A piece is formula text when math fonts set this share of it, and at least a few
# characters: a lone `→` or `⟨` in a math font marks a code listing or a UI transcript.
_SEED_MATH, _SEED_CHARS = 0.3, 3
_V_GAP, _H_GAP = 0.5, 0.8  # in line heights: stacked pieces touch, side-by-side ones nearly do


def _formula_like(block: Block) -> bool:
    text = block.text.strip()
    return len(text) <= _MAX_CHARS and len(_WORD.findall(text)) <= _MAX_WORDS


def _seed(block: Block) -> bool:
    math = sum(line.math_chars for line in block.lines)
    return math >= _SEED_CHARS and block.math_fraction >= _SEED_MATH


def _formula(pieces: list[Block]) -> bool:
    """A cluster reads as one formula: real math text, and not a table or a transcript."""
    words = sum(len(_WORD.findall(p.text)) for p in pieces)
    return len(pieces) > 1 and words <= _MAX_FORMULA_WORDS and any(_seed(p) for p in pieces)


def _gaps(a: Block, b: Block) -> tuple[float, float]:
    """Vertical and horizontal gap between two boxes; negative where they overlap."""
    (ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1) = a.bbox, b.bbox
    return max(ay0, by0) - min(ay1, by1), max(ax0, bx0) - min(ax1, bx1)


def _on_row_of(number: Block, other: Block) -> bool:
    middle = (number.bbox[1] + number.bbox[3]) / 2
    return bool(_NUMBER_ONLY.match(number.text.strip())) and (
        other.bbox[1] <= middle <= other.bbox[3]
    )


def _near(a: Block, b: Block) -> tuple[bool, float] | None:
    """How far apart two pieces are, in line heights, or None when they are not neighbours.

    An equation number set apart at the margin joins the formula on its row however far
    away, and before anything else, so each numbered equation gathers its own number."""
    size = max(a.size, b.size, 1.0)
    vertical, horizontal = _gaps(a, b)
    if _on_row_of(a, b) or _on_row_of(b, a):
        return False, horizontal / size
    if vertical > size * _V_GAP or horizontal > size * _H_GAP:
        return None
    return True, max(vertical, horizontal) / size


def _rows(lines: list[Line]) -> list[Line]:
    """Lines top to bottom by row, left to right within a row, the equation number last."""
    ordered: list[Line] = []
    row: list[Line] = []
    for line in sorted(lines, key=lambda ln: (ln.bbox[1] + ln.bbox[3]) / 2):
        middle = (line.bbox[1] + line.bbox[3]) / 2
        if row and middle - (row[0].bbox[1] + row[0].bbox[3]) / 2 > max(line.size, 1.0) / 2:
            ordered.extend(sorted(row, key=lambda ln: ln.bbox[0]))
            row = []
        row.append(line)
    ordered.extend(sorted(row, key=lambda ln: ln.bbox[0]))
    rightmost = max(ordered, key=lambda ln: ln.bbox[2])
    if EQUATION_NO.search(rightmost.text):
        ordered.remove(rightmost)
        ordered.append(rightmost)
    return ordered


def _glued(pieces: list[Block]) -> Block:
    lines = _rows([line for piece in pieces for line in piece.lines])
    return Block(page=pieces[0].page, lines=lines, pieces=len(pieces))


def merge_equations(blocks: list[Block]) -> list[Block]:
    """One page's prose blocks with each display formula's pieces glued into one block.

    The glued block takes the place of its first piece; other blocks keep their order."""
    candidates = [i for i, block in enumerate(blocks) if _formula_like(block)]
    parent = {i: i for i in candidates}
    numbered = {i: bool(EQUATION_NO.search(blocks[i].text)) for i in candidates}

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    pairs = []
    for i, j in combinations(candidates, 2):
        distance = _near(blocks[i], blocks[j])
        if distance is not None:
            pairs.append((distance, i, j))
    for _, i, j in sorted(pairs, key=lambda pair: pair[0]):
        a, b = root(i), root(j)
        if a == b or (numbered[a] and numbered[b]):
            continue
        parent[b] = a
        numbered[a] = numbered[a] or numbered[b]

    clusters: dict[int, list[int]] = {}
    for i in candidates:
        clusters.setdefault(root(i), []).append(i)
    glued: dict[int, Block] = {}
    absorbed: set[int] = set()
    for members in clusters.values():
        pieces = [blocks[i] for i in members]
        if not _formula(pieces):
            continue
        glued[members[0]] = _glued(pieces)
        absorbed.update(members[1:])
    return [glued.get(i, block) for i, block in enumerate(blocks) if i not in absorbed]
