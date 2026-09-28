"""A chapter's blocks as a one-reader script: what is said, in which part, citing what."""

import uuid
from typing import Any

from app.audio.reading import chapter_script, content_hash, pieces, spoken, word_count
from app.models import Node
from app.models.enums import NodeKind
from app.services.tree import TreeItem, build_tree

Spec = tuple[str, NodeKind, str, dict[str, Any]]
DOC = uuid.uuid4()


def unit(spec: list[Spec]) -> TreeItem:
    """The first spec row with the rest nested under it by anchor, as the reader loads it."""
    nodes: dict[str, Node] = {}
    for ordinal, (anchor, kind, content, meta) in enumerate(spec):
        parent = nodes.get(anchor.rsplit("/", 1)[0]) if "/" in anchor else None
        nodes[anchor] = Node(
            document_id=DOC,
            parent_id=parent.id if parent else None,
            anchor=anchor,
            kind=kind,
            ordinal=ordinal,
            depth=anchor.count("/"),
            heading=content if kind.is_container else None,
            text=None if kind.is_container else content,
            meta=meta,
        )
    (root,) = build_tree(list(nodes.values()))
    return root


def node(kind: NodeKind, text: str = "", **meta: Any) -> Node:
    return Node(
        document_id=DOC, anchor="ch01/x", kind=kind, ordinal=0, depth=1, text=text, meta=meta
    )


def said(script: dict[str, Any]) -> list[tuple[str, list[tuple[str, str]]]]:
    """Each part's title with its turns as (text, cited anchor)."""
    return [
        (s["title"], [(t["text"], t["cites"][0]) for t in s["turns"]]) for s in script["sections"]
    ]


CHAPTER: list[Spec] = [
    ("ch01", NodeKind.CHAPTER, "Stocks and flows", {}),
    ("ch01/p001", NodeKind.PARAGRAPH, "A system is more than  the sum\nof its parts.", {}),
    ("ch01/s01", NodeKind.SECTION, "Stocks", {}),
    ("ch01/s01/p001", NodeKind.PARAGRAPH, "A stock is the memory of flows.", {}),
    ("ch01/s01/f001", NodeKind.FIGURE, "", {"caption": "Figure 1.1 A bathtub"}),
    ("ch01/s01/c001", NodeKind.CODE, "while level < goal: level += 1", {}),
    ("ch01/s01/t001", NodeKind.TABLE, "| a | b |", {}),
    ("ch01/s02", NodeKind.SECTION, "Flows", {}),
    ("ch01/s02/p001", NodeKind.PARAGRAPH, "Flows change stocks.", {}),
]


def test_a_chapter_is_read_by_one_reader_heading_by_heading_citing_each_block():
    script = chapter_script(unit(CHAPTER))

    assert script["title"] == "Stocks and flows"
    assert [s["role"] for s in script["speakers"]] == ["reader"]
    assert {t["speaker"] for s in script["sections"] for t in s["turns"]} == {1}
    assert said(script) == [
        (
            "Stocks and flows",
            [
                ("Stocks and flows.", "ch01"),
                ("A system is more than the sum of its parts.", "ch01/p001"),
            ],
        ),
        (
            "Stocks",
            [
                ("Stocks.", "ch01/s01"),
                ("A stock is the memory of flows.", "ch01/s01/p001"),
                ("Figure 1.1 A bathtub.", "ch01/s01/f001"),
            ],
        ),
        ("Flows", [("Flows.", "ch01/s02"), ("Flows change stocks.", "ch01/s02/p001")]),
    ]


def test_parts_of_the_book_marked_skip_are_not_read():
    script = chapter_script(
        unit(
            [
                ("bm01", NodeKind.PART, "Back matter", {}),
                ("bm01/p001", NodeKind.PARAGRAPH, "Thanks for reading.", {}),
                ("bm01/s01", NodeKind.SECTION, "Index", {"skip": True}),
                ("bm01/s01/p001", NodeKind.PARAGRAPH, "Stocks, 12. Flows, 14.", {}),
            ]
        )
    )

    assert [text for _, turns in said(script) for text, _ in turns] == [
        "Back matter.",
        "Thanks for reading.",
    ]


def test_a_long_passage_is_split_between_sentences_into_parts_under_the_same_heading():
    sentence = "Every stock is a buffer against change."  # 7 words
    long = " ".join([sentence] * 5)
    script = chapter_script(
        unit(
            [
                ("ch02", NodeKind.CHAPTER, "Buffers", {}),
                ("ch02/p001", NodeKind.PARAGRAPH, long, {}),
                ("ch02/p002", NodeKind.PARAGRAPH, "Short.", {}),
            ]
        ),
        budget=15,
    )

    parts = said(script)
    assert [title for title, _ in parts] == ["Buffers"] * 3
    assert parts[0][1] == [("Buffers.", "ch02"), (f"{sentence} {sentence}", "ch02/p001")]
    assert parts[1][1] == [(f"{sentence} {sentence}", "ch02/p001")]
    assert parts[2][1] == [(sentence, "ch02/p001"), ("Short.", "ch02/p002")]
    assert all(len(turn[0].split()) <= 15 for _, turns in parts for turn in turns)


def test_a_chapter_with_nothing_readable_has_no_parts():
    script = chapter_script(
        unit([("ch03", NodeKind.CHAPTER, "", {}), ("ch03/c001", NodeKind.CODE, "x = 1", {})])
    )

    assert script["sections"] == []
    assert word_count(script) == 0


def test_list_items_are_said_one_by_one_as_sentences():
    from_meta = node(NodeKind.LIST, "ignored", items=["Pick two", "Name them!"], ordered=True)
    from_text = node(NodeKind.LIST, "1. What varies?\n2) Pick 2 or 3\n• Name each one")

    assert spoken(from_meta) == "Pick two. Name them!"
    assert spoken(from_text) == "What varies? Pick 2 or 3. Name each one."


def test_an_aside_is_introduced_by_its_label_and_its_wrapped_lines_join_up():
    aside = node(NodeKind.ASIDE, "Structured the project\ninto 3 phases.", label="KEY TAKEAWAYS")

    assert spoken(aside) == "Key takeaways. Structured the project into 3 phases."
    assert spoken(node(NodeKind.ASIDE, "Plain  aside.")) == "Plain aside."


def test_what_only_the_eye_uses_is_not_said():
    note = node(NodeKind.PARAGRAPH, "[22] To do all this, here is a structure [3, 4]:")
    emoji = node(NodeKind.LIST, "- \ufe0f\u2705 I bring distributed systems", items=None)

    assert spoken(note) == "To do all this, here is a structure:"
    assert spoken(emoji) == "I bring distributed systems."
    assert spoken(node(NodeKind.PARAGRAPH, "self\u00adcontained")) == "selfcontained."
    accented = "Cafe\u0301 cr\u00e8me"  # a combining accent is kept
    assert spoken(node(NodeKind.PARAGRAPH, accented)) == f"{accented}."


def test_a_heading_set_as_a_paragraph_gets_a_pause_but_a_split_sentence_is_left_alone():
    heading = node(NodeKind.PARAGRAPH, "A simple structure for TMAY")
    carried = "strategy, which reduced page load times by forty percent and kept customers"

    assert spoken(heading) == "A simple structure for TMAY."
    assert spoken(node(NodeKind.PARAGRAPH, carried)) == carried


def test_what_does_not_read_aloud_says_nothing():
    assert spoken(node(NodeKind.CODE, "print(1)")) == ""
    assert spoken(node(NodeKind.MATH, "e = mc^2")) == ""
    assert spoken(node(NodeKind.TABLE, "| a |")) == ""
    assert spoken(node(NodeKind.FIGURE, "")) == ""


def test_pieces_keep_closing_quotes_with_their_sentence_and_a_long_sentence_whole():
    assert pieces("One two. “Three four.” Five six! Seven", 4) == [
        "One two. “Three four.”",
        "Five six! Seven",
    ]
    assert pieces("a b c d e f", 2) == ["a b c d e f"]


def test_the_content_hash_names_the_words_read():
    script = chapter_script(unit(CHAPTER))
    edited = [*CHAPTER[:-1], ("ch01/s02/p001", NodeKind.PARAGRAPH, "Flows fill stocks.", {})]

    assert content_hash(script) == content_hash(chapter_script(unit(CHAPTER)))
    assert content_hash(script) != content_hash(chapter_script(unit(edited)))
    assert word_count(script) == 29
