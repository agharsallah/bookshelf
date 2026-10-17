"""§7 over HTTP: the context routes, full option objects as the form sends them, settings."""

import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes.builds import get_probe
from app.models import Build
from app.schemas.build_options import BuildAdvanced
from tests.builds.factories import GOAL, FakeProbe, known_paper
from tests.builds.test_api import plan_it, start
from tests.conftest import AUTH
from tests.papers.conftest import make_paper

API = "/api/v1"


@pytest.fixture
def api(client: TestClient) -> Iterator[TestClient]:
    app = client.app
    assert isinstance(app, FastAPI)
    app.dependency_overrides[get_probe] = FakeProbe
    yield client
    app.dependency_overrides.clear()


def full_options(**changes: object) -> dict:
    """Every key, as the form sends it (blank text as null, every section on: null)."""
    return {
        "repo_name": "", "visibility": "private", "owner": None, "claude_attribution": False,
        "link_paper": True, "stack": None, "allow_web": False,
        "context": {"sections": None, "notes": None}, "references": [],
        "advanced": BuildAdvanced().model_dump(mode="json"), **changes,
    }  # fmt: skip


def test_the_preview_lists_sections_header_and_suggestions(api: TestClient, session: Session):
    paper = known_paper(session, meta={"arxiv_id": "2101.00001",
                                       "code_urls": ["https://github.com/acme/gated"]})  # fmt: skip

    linked = api.get(f"{API}/papers/{paper.slug}/builds/context", params={"link_paper": "true"})
    hidden = api.get(f"{API}/papers/{paper.slug}/builds/context", params={"link_paper": "false"})

    assert linked.status_code == 200
    body = linked.json()
    assert [s["key"] for s in body["sections"]][:3] == ["tldr", "question", "core_ideas"]
    assert len(body["sections"]) == 9 and body["sections"][0]["words"] > 0
    assert body["header"].startswith("# Gated Readers")
    assert hidden.json()["header"] == "# The paper's core ideas"
    assert [(s["source"], s["url"]) for s in body["suggested_references"]] == [
        ("code", "https://github.com/acme/gated"),
        ("paper", "https://arxiv.org/abs/2101.00001"),
    ]


def test_render_shows_what_a_new_build_would_read(api: TestClient, session: Session):
    paper = known_paper(session)
    shelf = make_paper(session, "Dense Passage Retrieval")
    options = full_options(
        context={"sections": ["tldr"], "notes": "Use NumPy."},
        references=[
            {"kind": "url", "url": "https://x.org/a", "title": "A", "note": None, "snapshot": True,
             "document_id": None},
            {"kind": "shelf", "url": None, "document_id": str(shelf.id), "title": "DPR",
             "note": None, "snapshot": False},
        ],
        advanced={**BuildAdvanced().model_dump(mode="json"), "model": "sonnet",
                  "extra_commands": ["make"], "license": "MIT"},
    )  # fmt: skip

    response = api.post(f"{API}/papers/{paper.slug}/builds/context/render", headers=AUTH,
                        json={"options": options})  # fmt: skip

    assert response.status_code == 200, response.text
    view = response.json()
    assert view["source"] == "rendered" and view["model"] == "sonnet"
    files = {f["path"]: f for f in view["files"]}
    assert list(files) == ["docs/PAPER.md", "docs/REFERENCES.md", "docs/references/01-a.md",
                           "docs/references/02-dpr.md", "docs/NOTES.md", "LICENSE"]  # fmt: skip
    assert files["docs/references/01-a.md"]["pending"] is True
    assert "## Claims" not in files["docs/PAPER.md"]["content"]
    assert files["docs/PAPER.md"]["words"] > 0
    assert "the plan is drafted after you start" in view["kickoff"].lower()
    assert "Bash(make:*)" in view["allowed_tools"]
    cmd = view["command"]
    assert cmd[cmd.index("--append-system-prompt") + 1] == "<agent brief>"
    assert view["agent_brief"].startswith("# Build from a paper")
    assert view["plan_input"]["notes"] == "Use NumPy." and view["plan_input"]["goal"]


@pytest.mark.parametrize(
    ("options", "status"),
    [({"advanced": {"extra_commands": ["git"]}}, 422),
     ({"visibility": "local", "advanced": {"delivery": "pull_request"}}, 422),
     ({"references": [{"kind": "shelf", "document_id": str(uuid.uuid4()), "title": "Gone"}]},
      422)],
)  # fmt: skip
def test_render_and_create_refuse_bad_options(
    api: TestClient, session: Session, options: dict, status: int
):
    paper = known_paper(session)

    render = api.post(f"{API}/papers/{paper.slug}/builds/context/render", headers=AUTH,
                      json={"options": options})  # fmt: skip
    create = api.post(f"{API}/papers/{paper.slug}/builds", json={"goal": GOAL, "options": options},
                      headers=AUTH)  # fmt: skip

    assert (render.status_code, create.status_code) == (status, status)


def test_create_and_approve_take_the_full_options(api: TestClient, session: Session):
    paper = known_paper(session)
    created = start(api, paper.slug, options=full_options(
        context={"sections": None, "notes": "Hello."},
        advanced={**BuildAdvanced().model_dump(mode="json"), "delivery": "pull_request"},
    ))  # fmt: skip
    assert created["options"]["context"] == {"sections": None, "notes": "Hello."}
    assert created["options"]["advanced"]["delivery"] == "pull_request"
    assert created["pr_url"] is None
    plan_it(session, created["id"])

    approve = {
        **created["options"],
        "repo_name": "gated-reader",
        "advanced": {**created["options"]["advanced"], "push": "at_end"},
    }
    approved = api.post(f"{API}/builds/{created['id']}/approve", json={"options": approve},
                        headers=AUTH)  # fmt: skip

    assert approved.status_code == 202, approved.text
    options = approved.json()["options"]
    assert options["repo_name"] == "gated-reader" and options["advanced"]["push"] == "at_end"
    assert options["advanced"]["delivery"] == "pull_request"
    assert options["context"]["notes"] == "Hello."


def test_a_build_context_is_rendered_until_the_workspace_exists(
    api: TestClient, session: Session, tmp_path: Path
):
    paper = known_paper(session)
    build_id = start(api, paper.slug, options={"advanced": {"license": "MIT"}})["id"]
    plan_it(session, build_id)

    rendered = api.get(f"{API}/builds/{build_id}/context").json()
    assert rendered["source"] == "rendered"
    assert [f["path"] for f in rendered["files"]] == [
        "README.md", "docs/PAPER.md", "docs/PLAN.md", "LICENSE", ".gitignore",
    ]  # fmt: skip
    assert "## Milestones" in rendered["kickoff"]

    repo = tmp_path / "build" / "repo"
    (repo / "docs").mkdir(parents=True)
    (repo / "README.md").write_text("# readme\n")
    (repo / "docs" / "PAPER.md").write_text("# what the agent got\n")
    (repo / "src.py").write_text("print()\n")
    (repo.parent / "kickoff.md").write_text("# Build\n\nthe real kickoff\n")
    build = session.get(Build, build_id)
    assert build is not None
    build.workspace = str(repo)
    session.add(build)
    session.commit()

    real = api.get(f"{API}/builds/{build_id}/context").json()
    assert real["source"] == "workspace"
    assert [(f["path"], f["content"]) for f in real["files"]] == [
        ("README.md", "# readme\n"), ("docs/PAPER.md", "# what the agent got\n"),
    ]  # fmt: skip
    assert real["kickoff"] == "# Build\n\nthe real kickoff\n"
    assert real["plan_input"]["goal"] == GOAL


def test_pr_url_comes_from_the_runners_event(api: TestClient, session: Session):
    paper = known_paper(session)
    build_id = start(api, paper.slug)["id"]
    build = session.get(Build, build_id)
    assert build is not None
    build.events = [{"at": "2026-10-03T10:00:00Z", "kind": "system",
                     "text": "Pull request: https://github.com/o/r/pull/7"}]  # fmt: skip
    session.add(build)
    session.commit()

    assert api.get(f"{API}/builds/{build_id}").json()["pr_url"] == "https://github.com/o/r/pull/7"


def test_settings_take_the_full_builds_object_with_advanced(client: TestClient):
    builds = client.get(f"{API}/settings").json()["builds"]
    advanced = {**builds["advanced"], "model": "opus", "license": "Apache-2.0"}
    full = {**builds, "owner": "acme", "advanced": advanced}

    response = client.patch(f"{API}/settings", json={"builds": full}, headers=AUTH)
    partial = client.patch(f"{API}/settings", json={"builds": {"advanced": {"tests": "smoke"}}},
                           headers=AUTH)  # fmt: skip

    assert response.status_code == 200, response.text
    advanced = partial.json()["builds"]["advanced"]
    assert (advanced["model"], advanced["license"], advanced["tests"]) == (
        "opus", "Apache-2.0", "smoke",
    )  # fmt: skip
    assert partial.json()["builds"]["owner"] == "acme"
    bad = client.patch(f"{API}/settings", json={"builds": {"advanced": {"model": "gpt"}}},
                       headers=AUTH)  # fmt: skip
    assert bad.status_code == 422


def test_settings_defaults_seed_a_new_build(api: TestClient, session: Session):
    api.patch(f"{API}/settings", json={"builds": {"advanced": {"license": "MIT",
                                                               "delivery": "pull_request"}}},
              headers=AUTH)  # fmt: skip
    paper = known_paper(session)

    github = start(api, paper.slug)["options"]["advanced"]
    local = start(api, paper.slug, options={"visibility": "local"})["options"]["advanced"]

    assert (github["license"], github["delivery"]) == ("MIT", "pull_request")
    assert (local["license"], local["delivery"]) == ("MIT", "push_main")
