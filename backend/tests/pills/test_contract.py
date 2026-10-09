"""contracts/pill.schema.json, its examples and the Pydantic mirror agree."""

import copy

import pytest
from pydantic import ValidationError

from app.models.enums import PillKind
from app.pills.contract import BODY_MODELS, PILL_SCHEMA_ID, PillOut
from app.pipeline.gates import schema_errors
from app.schemas.pills import (
    EventsResult,
    FeedList,
    FeedOut,
    Finished,
    GenerateResult,
    JobsQueued,
    SessionContinuation,
    SessionStart,
    Supply,
)
from tests.pills.fixtures import api_examples, pill_examples

SCHEMA = {"$ref": PILL_SCHEMA_ID}
EXAMPLES = pill_examples()


def test_there_is_one_example_and_one_body_model_per_kind():
    assert set(EXAMPLES) == {k.value for k in PillKind}
    assert set(BODY_MODELS) == set(PillKind)
    assert all(EXAMPLES[k]["kind"] == k for k in EXAMPLES)


@pytest.mark.parametrize("kind", sorted(EXAMPLES))
def test_each_example_is_valid_and_round_trips_through_the_models(kind: str):
    example = EXAMPLES[kind]

    assert schema_errors(SCHEMA, example) == []
    assert PillOut.model_validate(example).model_dump(mode="json") == example


@pytest.mark.parametrize("kind", sorted(EXAMPLES))
def test_a_body_of_another_kind_is_refused_by_both(kind: str):
    other = "listen" if kind != "listen" else "quiz"
    wrong = copy.deepcopy(EXAMPLES[kind]) | {"body": EXAMPLES[other]["body"]}

    assert schema_errors(SCHEMA, wrong) != []
    with pytest.raises(ValidationError):
        PillOut.model_validate(wrong)


def test_a_quiz_answer_must_index_a_choice():
    quiz = copy.deepcopy(EXAMPLES["quiz"])
    quiz["body"]["answer"] = len(quiz["body"]["choices"])

    with pytest.raises(ValidationError):
        PillOut.model_validate(quiz)


def test_a_cross_document_cite_needs_the_slug_form():
    pill = copy.deepcopy(EXAMPLES["connection"])
    pill["cites"].append("Not A Cite")

    assert schema_errors(SCHEMA, pill) != []
    with pytest.raises(ValidationError):
        PillOut.model_validate(pill)


# The API's bodies: the frontend's types are tested against the same examples
# (frontend/src/lib/pills/types.test.ts), so a field added or renamed on one side fails.
API_MODELS = {
    "session_start": SessionStart,
    "session_continuation": SessionContinuation,
    "finished": Finished,
    "events_result": EventsResult,
    "supply": Supply,
    "generate_result": GenerateResult,
    "jobs_queued": JobsQueued,
    "feed": FeedOut,
    "feed_list": FeedList,
}


def test_there_is_one_api_example_per_response_model():
    assert set(api_examples()) == set(API_MODELS)


@pytest.mark.parametrize("name", sorted(API_MODELS))
def test_each_api_example_is_exactly_what_its_response_model_sends(name: str):
    example = api_examples()[name]

    assert API_MODELS[name].model_validate(example).model_dump(mode="json") == example
