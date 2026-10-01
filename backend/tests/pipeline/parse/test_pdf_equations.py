"""Display formulas MuPDF cut into pieces are glued back into one block, and only formulas."""

# ruff: noqa: RUF001 - math glyphs are the point

from app.models.enums import NodeKind
from app.pipeline.parse.model import ParsedNode
from app.pipeline.parse.pdf.equations import merge_equations
from app.pipeline.parse.pdf.layout import Block, Line
from app.pipeline.parse.pdf.prose import build_leaves


def piece(x0: float, y0: float, x1: float, y1: float, text: str, *, math: bool = True) -> Block:
    """One MuPDF block of one line; `math` sets every non-space character in a math font."""
    chars = len(text.replace(" ", "")) if math else 0
    line = Line(page=1, bbox=(x0, y0, x1, y1), text=text, size=10.0, math_chars=chars)
    return Block(page=1, lines=[line])


PROSE = piece(70, 86, 525, 112, "then optimizes the policy by maximizing the following objective:",
              math=False)  # fmt: skip
# `(1/G) Σ_{i=1}^{G} π_θ(o_i|q) / π_old(o_i|q)    (1)` as MuPDF returns it: seven blocks.
OBJECTIVE = [
    piece(118, 146, 125, 169, "1 G"),
    piece(133, 141, 138, 148, "G"),
    piece(129, 149, 143, 160, "∑", math=False),
    piece(130, 167, 141, 176, "i=1"),
    piece(172, 144, 255, 156, "πθ(oi|q)"),
    piece(172, 160, 255, 172, "πθold(oi|q)"),
    piece(463, 145, 525, 164, ", (1)", math=False),
]


def test_the_pieces_of_a_formula_become_one_block_ending_in_its_number():
    blocks = merge_equations([PROSE, *OBJECTIVE])

    assert blocks[0] is PROSE
    [formula] = blocks[1:]
    assert formula.pieces == len(OBJECTIVE)
    assert formula.bbox == (118, 141, 525, 176)
    assert formula.text.endswith("(1)")


def test_two_numbered_equations_stay_apart_however_close():
    first = [piece(200, 100, 260, 112, "a = b"), piece(470, 100, 525, 112, "(1)", math=False)]
    second = [piece(200, 114, 260, 126, "c = d"), piece(470, 114, 525, 126, "(2)", math=False)]

    blocks = merge_equations([*first, *second])

    assert [b.text for b in blocks] == ["a = b (1)", "c = d (2)"]


def test_a_code_listing_marked_with_math_arrows_is_not_a_formula():
    """OpenHands draws `↪` continuation marks in a math font beside each wrapped code line."""
    listing = [
        piece(72, 100, 80, 110, "↪"),
        piece(84, 100, 400, 110, "def hover(bid: str):", math=False),
        piece(84, 110, 400, 120, "Hover over an element.", math=False),
    ]

    assert merge_equations(listing) == listing


def test_a_table_of_short_cells_is_not_a_formula():
    table = [
        ["Agent", "Solved", "Cost"],
        ["Raw agent", "17.0", "1.12"],
        ["Observation masking", "15.0", "0.90"],
        ["LLM summary", "16.2", "0.95"],
    ]
    cells = [
        piece(72 + 60 * col, 100 + 12 * row, 128 + 60 * col, 111 + 12 * row, text, math=False)
        for row, labels in enumerate(table)
        for col, text in enumerate(labels)
    ]
    cells[4] = piece(132, 112, 188, 123, "+3.1σ")  # one cell set in a math font

    assert merge_equations(cells) == cells


def test_a_glued_formula_is_one_math_leaf_with_its_number_and_no_guessed_latex():
    [formula] = merge_equations(OBJECTIVE)

    leaves, _ = build_leaves([formula])

    [math] = [n for n in leaves if isinstance(n, ParsedNode)]
    assert math.kind is NodeKind.MATH
    assert math.meta["equation_no"] == "1"
    assert math.meta["latex"] is None  # the pieces' text order is not the formula's
    assert math.crop is not None
    assert math.crop.bbox == (116, 139, 527, 178)
