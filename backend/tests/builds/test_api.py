"""`/api/v1` builds routes: shapes, route order, auth, status codes."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes.builds import get_probe
from app.models import Build
from app.models.build import BuildState
from app.models.enums import Origin, Review
from tests.api.factories import make_document
from tests.builds.factories import GOAL, FakeProbe, known_paper, valid_plan
from tests.conftest import AUTH

API = "/api/v1"


@pytest.fixture
def api(client: TestClient) -> Iterator[TestClient]:
    """The client with a ready fake machine behind preflight."""
    app = client.app
    assert isinstance(app, FastAPI)
    app.dependency_overrides[get_probe] = FakeProbe
    yield client
    app.dependency_overrides.clear()


def start(api: TestClient, ref: str, **body: object) -> dict:
    response = api.post(f"{API}/papers/{ref}/builds", json={"goal": GOAL, **body}, headers=AUTH)
    assert response.status_code == 202, response.text
    return response.json()


def plan_it(session: Session, build_id: str) -> None:
    build = session.get(Build, build_id)
    assert build is not None
    build.state, build.plan, build.plan_origin = BuildState.PLANNED, valid_plan(), Origin.SKILL
    session.add(build)
    session.commit()


def test_presets_and_preflight_are_not_read_as_build_ids(api: TestClient, session: Session):
    paper = known_paper(session, card=Review.DRAFT)

    presets = api.get(f"{API}/builds/presets")
    check = api.get(f"{API}/builds/preflight", headers=AUTH, params={"document": paper.slug,
                                                       "visibility": "local"})  # fmt: skip

    assert presets.status_code == 200
    assert {"key", "label", "goal", "toolchains", "stops"} <= set(presets.json()[0])
    assert check.status_code == 200 and check.json()["ready"] is True
    card = next(c for c in check.json()["checks"] if c["key"] == "paper_card")
    assert (card["ok"], card["level"]) == (False, "warning")
    assert card["fix"] == "Approve the paper card in Review."
    assert "gh_auth" not in {c["key"] for c in check.json()["checks"]}


def test_create_list_and_get(api: TestClient, session: Session):
    paper = known_paper(session)

    created = start(api, paper.slug, options={"visibility": "local"}, stops={"done_when": ["ok"]})
    listed = api.get(f"{API}/papers/{paper.slug}/builds").json()
    one = api.get(f"{API}/builds/{created['id']}").json()

    assert created["state"] == "planning" and created["plan_job_id"]
    assert created["options"]["visibility"] == "local" and created["stops"]["done_when"] == ["ok"]
    assert [b["id"] for b in listed] == [created["id"]] and "events" not in listed[0]
    assert one["events"] == [] and one["plan"] is None and one["elapsed_seconds"] is None


def test_a_failing_preflight_is_a_409_with_the_checks(api: TestClient, session: Session):
    paper = known_paper(session)
    api.app.dependency_overrides[get_probe] = lambda: FakeProbe(missing=["git"])  # type: ignore[attr-defined]

    response = api.post(f"{API}/papers/{paper.slug}/builds", json={"goal": GOAL}, headers=AUTH)

    assert response.status_code == 409
    keys = {d["key"] for d in response.json()["error"]["details"]}
    assert keys == {"git_cli", "git_identity"}


def test_the_full_flow_through_the_api(api: TestClient, session: Session):
    paper = known_paper(session)
    build_id = start(api, paper.slug)["id"]
    assert api.post(f"{API}/builds/{build_id}/approve", headers=AUTH).status_code == 409

    plan_it(session, build_id)
    edited = {**valid_plan(), "summary": "Hand-edited: the smallest working reader."}
    put = api.put(f"{API}/builds/{build_id}/plan", json={"plan": edited}, headers=AUTH)
    assert put.status_code == 200 and put.json()["plan_origin"] == "human"

    approved = api.post(f"{API}/builds/{build_id}/approve",
                        json={"stops": {"max_commits": 4}}, headers=AUTH)  # fmt: skip
    assert approved.status_code == 202
    assert approved.json()["state"] == "building" and approved.json()["stops"]["max_commits"] == 4
    assert api.delete(f"{API}/builds/{build_id}", headers=AUTH).status_code == 409

    stopped = api.post(f"{API}/builds/{build_id}/stop", headers=AUTH).json()
    assert stopped["state"] == "stopping" and stopped["stop_requested"] is True
    assert api.post(f"{API}/builds/{build_id}/continue", json={}, headers=AUTH).status_code == 409


def test_replan_continue_and_delete(api: TestClient, session: Session):
    paper = known_paper(session)
    build_id = start(api, paper.slug)["id"]
    plan_it(session, build_id)

    replanned = api.post(f"{API}/builds/{build_id}/replan", json={"feedback": "Use JAX."},
                         headers=AUTH)  # fmt: skip
    assert replanned.status_code == 202 and replanned.json()["plan_feedback"] == "Use JAX."

    build = session.get(Build, build_id)
    assert build is not None
    session.refresh(build)
    build.state = BuildState.DONE
    session.commit()
    resumed = api.post(f"{API}/builds/{build_id}/continue",
                       json={"goal": "Now add a demo notebook.", "stops": {"max_minutes": 15}},
                       headers=AUTH)  # fmt: skip
    assert resumed.status_code == 202 and resumed.json()["state"] == "building"

    build.state = BuildState.STOPPED
    session.add(build)
    session.commit()
    assert api.delete(f"{API}/builds/{build_id}", headers=AUTH).status_code == 204
    assert api.get(f"{API}/builds/{build_id}").status_code == 404


def test_writes_need_the_api_key_and_bodies_are_validated(api: TestClient, session: Session):
    paper = known_paper(session)
    url = f"{API}/papers/{paper.slug}/builds"

    assert api.post(url, json={"goal": GOAL}).status_code == 401
    assert api.post(url, json={"goal": "short"}, headers=AUTH).status_code == 422
    bad_name = {"goal": GOAL, "options": {"repo_name": "no spaces allowed"}}
    assert api.post(url, json=bad_name, headers=AUTH).status_code == 422
    assert api.post(url, json={"goal": GOAL, "preset": "nope"}, headers=AUTH).status_code == 422


def test_a_book_has_no_builds(api: TestClient, session: Session):
    book = make_document(session)

    assert api.get(f"{API}/papers/{book.slug}/builds").status_code == 404
