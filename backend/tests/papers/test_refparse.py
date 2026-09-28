"""papers.refparse: bibliography entries and their fields, in the common styles."""

# ruff: noqa: RUF001

from app.papers.refparse import Leaf, parse_entry, parse_references, split_authors, split_entries


def test_a_numbered_neurips_entry_splits_into_its_fields():
    ref = parse_entry(
        "[1] Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. Layer normalization. "
        "arXiv preprint arXiv:1607.06450, 2016.",
        1,
        "ch10/p001",
    )

    assert ref.authors == ["Jimmy Lei Ba", "Jamie Ryan Kiros", "Geoffrey E. Hinton"]
    assert (ref.title, ref.venue, ref.year, ref.arxiv_id) == (
        "Layer normalization",
        "arXiv",
        2016,
        "1607.06450",
    )


def test_an_acl_entry_keeps_its_year_suffix_and_venue():
    ref = parse_entry(
        "Matthew Peters, Mark Neumann, and Luke Zettlemoyer. 2018b. Dissecting contextual word "
        "embeddings. In Proceedings of the 2018 Conference on EMNLP, pages 1499–1509.",
        37,
        None,
    )

    assert (ref.year, ref.year_label, ref.title) == (
        2018,
        "2018b",
        "Dissecting contextual word embeddings",
    )
    assert ref.venue == "Proceedings of the 2018 Conference on EMNLP"
    assert ref.surnames == ["peters", "neumann", "zettlemoyer"]


def test_an_apa_entry_turns_surname_initial_pairs_around():
    ref = parse_entry(
        "Vaswani, A., & Shazeer, N. (2017). Attention is all you need. NeurIPS, 30.", 1, None
    )

    assert ref.authors == ["A. Vaswani", "N. Shazeer"]
    assert (ref.year, ref.title, ref.venue) == (2017, "Attention is all you need", "NeurIPS")


def test_dois_and_corr_ids_are_found_anywhere():
    ref = parse_entry(
        "[2] Dzmitry Bahdanau. Neural machine translation. CoRR, abs/1409.0473, 2014. "
        "doi:10.48550/arXiv.1409.0473.",
        2,
        None,
    )

    assert (ref.arxiv_id, ref.doi, ref.venue) == ("1409.0473", "10.48550/arxiv.1409.0473", "CoRR")


def test_question_marks_stay_in_titles_and_editors_leave_venues():
    ref = parse_entry(
        "[16] Łukasz Kaiser and Samy Bengio. Can active memory replace attention? In D. Lee, "
        "editors, Advances in Neural Information Processing Systems, 2016.",
        16,
        None,
    )

    assert ref.title == "Can active memory replace attention?"
    assert ref.venue == "Advances in Neural Information Processing Systems"


def test_author_lists_drop_et_al():
    assert split_authors("Yonghui Wu, Mike Schuster, et al") == ["Yonghui Wu", "Mike Schuster"]


def test_author_year_leaves_split_by_mupdf_join_back_into_entries():
    leaves = [
        Leaf("r/p001", "Alan Akbik, Duncan Blythe, and Roland Vollgraf."),
        Leaf("r/p002", "2018. Contextual string embeddings. In COLING."),
        Leaf("r/p003", "Z. Chen, H. Zhang, and L. Zhao. 2018."),
        Leaf("r/p004", "Quora question pairs."),
        Leaf("r/p005", "Rie Kubota Ando and Tong Zhang. 2005. A framework"),
        Leaf("r/p006", "for learning predictive structures. JMLR."),
    ]

    entries = split_entries(leaves)

    assert [anchor for anchor, _ in entries] == ["r/p001", "r/p003", "r/p005"]
    assert entries[1][1] == "Z. Chen, H. Zhang, and L. Zhao. 2018. Quora question pairs."


def test_numbered_entries_run_together_in_one_leaf_are_split_on_the_next_marker():
    leaves = [
        Leaf("r/p001", "[1] A. One. First. 2017. [2] B. Two. Second, cf. [5]. 2018."),
        Leaf("r/p002", "continued text"),
        Leaf("r/p003", "[3] C. Three. Third. 2019."),
    ]

    refs = parse_references(leaves)

    assert [r.ordinal for r in refs] == [1, 2, 3]
    assert refs[1].raw == "[2] B. Two. Second, cf. [5]. 2018. continued text"


def test_marked_leaves_are_entries_as_they_are_and_numbered_by_position_without_markers():
    leaves = [
        Leaf("r/p001", "Ada Lovelace. 1998. Notes.", True),
        Leaf("r/p002", "Alan Turing. 1936. On numbers.", True),
    ]

    refs = parse_references(leaves)

    assert [(r.ordinal, r.anchor, r.year) for r in refs] == [
        (1, "r/p001", 1998),
        (2, "r/p002", 1936),
    ]
