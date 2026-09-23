"""Tree nesting and deterministic anchors (D4): the rules every parser shares."""

from app.models.enums import NodeKind
from app.pipeline.parse.anchors import ANCHOR_RE, assign_anchors, content_hash
from app.pipeline.parse.model import Event, Heading, ParsedNode
from app.pipeline.parse.text import join_lines
from app.pipeline.parse.tree import build_tree


def _p(text: str, page: int | None = None) -> ParsedNode:
    return ParsedNode(NodeKind.PARAGRAPH, text=text, page_from=page, page_to=page)


def _anchored(events: list[Event]) -> list[tuple[str, str]]:
    roots = build_tree(events)
    assign_anchors(roots)
    return [(n.anchor, n.heading or n.text or "") for root in roots for n in root.walk()]


def test_leaves_are_numbered_per_kind_within_their_parent():
    events: list[Event] = [
        Heading(1, "One"),
        _p("a"),
        ParsedNode(NodeKind.FIGURE, text="fig"),
        _p("b"),
        ParsedNode(NodeKind.TABLE, text="t"),
        Heading(2, "Sub"),
        _p("c"),
        Heading(3, "Deeper"),
        ParsedNode(NodeKind.CODE, text="x"),
    ]

    assert _anchored(events) == [
        ("ch01", "One"),
        ("ch01/p001", "a"),
        ("ch01/f001", "fig"),
        ("ch01/p002", "b"),  # a figure in between does not renumber paragraphs
        ("ch01/t001", "t"),
        ("ch01/s01", "Sub"),
        ("ch01/s01/p001", "c"),
        ("ch01/s01/ss01", "Deeper"),
        ("ch01/s01/ss01/c001", "x"),
    ]


def test_parts_nest_chapters_and_leading_content_goes_to_front_matter():
    events: list[Event] = [_p("preface"), Heading(0, "Part I"), Heading(1, "Ch"), _p("x")]

    assert _anchored(events) == [
        ("fm01", "Front matter"),
        ("fm01/p001", "preface"),
        ("pt01", "Part I"),
        ("pt01/ch01", "Ch"),
        ("pt01/ch01/p001", "x"),
    ]


def test_section_before_any_chapter_is_promoted_to_chapter():
    assert _anchored([Heading(2, "Orphan"), _p("x")]) == [
        ("ch01", "Orphan"),
        ("ch01/p001", "x"),
    ]


def test_bibliography_and_index_are_kept_but_marked_skip():
    roots = build_tree([Heading(1, "Body"), Heading(1, "Bibliography"), Heading(1, "Index")])

    assert [(r.heading, r.meta.get("skip", False)) for r in roots] == [
        ("Body", False),
        ("Bibliography", True),
        ("Index", True),
    ]


def test_anchors_match_the_render_contract_pattern_even_past_999_leaves():
    events: list[Event] = [Heading(1, "Long"), *(_p(str(i)) for i in range(1001))]
    anchors = [anchor for anchor, _ in _anchored(events)]

    assert anchors[-1] == "ch01/p1001"
    assert all(ANCHOR_RE.match(a) for a in anchors)


def test_containers_span_their_descendants_pages():
    [chapter] = build_tree([Heading(1, "C", page=4), _p("a", 5), Heading(2, "S", 6), _p("b", 9)])

    assert (chapter.page_from, chapter.page_to) == (4, 9)
    assert (chapter.children[-1].page_from, chapter.children[-1].page_to) == (6, 9)


def test_content_hash_ignores_whitespace_and_unicode_compatibility_forms():
    assert content_hash("of\ufb01ce  hours\n") == content_hash("office hours")
    assert content_hash("office hours") != content_hash("office hour")


def test_line_joining_undoes_hyphenation_but_keeps_real_compounds():
    assert join_lines(["a feed-", "back loop"]) == "a feedback loop"
    assert join_lines(["Jean-", "Paul wrote"]) == "Jean-Paul wrote"
    assert join_lines(["soft\u00ad", "hyphen"]) == "softhyphen"
