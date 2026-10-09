"""The graph harvester (`app.pills.harvest.graph`): connections across two documents."""

import uuid

import pytest

from app.models.enums import PillKind
from app.pills.harvest.graph import ConnectionLink, LinkSide, harvest_connections, is_prose
from tests.pills.fixtures import DOC_ID, context


def _side(doc: uuid.UUID, slug: str, anchor: str, text: str) -> LinkSide:
    return LinkSide(document_id=doc, slug=slug, title=slug.title(), anchor=anchor, text=text)


def test_a_connection_cites_the_other_side_by_slug():
    other = uuid.uuid4()
    link = ConnectionLink(
        edge_id=uuid.uuid4(),
        relation="echoes",
        concept="slack",
        headline=None,
        sides=(
            _side(
                DOC_ID,
                "okafor-queueing",
                "ch03/s03/p001",
                "If waiting is the price of busyness, slack is not waste.",
            ),
            _side(
                other,
                "meadows-systems",
                "ch05/p002",
                "Buffers are stocks that stabilize a system against flows.",
            ),
        ),
    )
    short = ConnectionLink(
        edge_id=uuid.uuid4(),
        relation="echoes",
        concept=None,
        headline=None,
        sides=(_side(DOC_ID, "o", "ch01/p001", "Too short."), link.sides[1]),
    )

    (pill,) = harvest_connections(context(), [link, short])

    assert pill.kind is PillKind.CONNECTION
    assert pill.anchor == "ch03"
    assert pill.cites == ["ch03/s03/p001", "meadows-systems:ch05/p002"]
    assert pill.body["sides"][1]["document"]["slug"] == "meadows-systems"
    assert pill.body["sides"][1]["spans"][0]["cites"] == ["ch05/p002"]
    assert pill.concepts == ["slack"]
    assert pill.origin == "harvest:graph"


@pytest.mark.parametrize(
    "text",
    [
        "and Ofir Press. SWE-agent: Agent-computer interfaces enable automated software "
        "engineering. Advances in Neural Information Processing Systems, 37:50528, 2024.",
        "Jingyu Liu, Tal Remez, Jeremy Rapin, Artyom Kozhevnikov, Ivan Evtimov, Joanna Bitton",
        "SWE-Gym-32B Qwen2.5-Coder-32B OpenHands 20.6 R2E-Gym-32B 34.4 Skywork 38.0 41.2 12.5",
    ],
)
def test_a_reference_an_author_list_or_a_table_row_is_no_connection_side(text: str):
    assert not is_prose(text)


def test_prose_with_a_citation_or_a_number_is_a_connection_side():
    assert is_prose("Agents such as SWE-agent (Yang et al., 2024) solve 12.5% of the issues.")
