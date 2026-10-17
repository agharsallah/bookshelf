"""§7c over HTTP: the repo list, the target inspection, a create into an existing repository,
and what its context view and planner input show (real git for local targets)."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes.builds import get_github, get_probe
from app.builds import planning
from app.builds.github import FakeGitHub, RepoInfo
from app.models import Build
from tests.builds.factories import FakeProbe, known_paper
from tests.builds.runner.conftest import make_user_repo
from tests.builds.test_api import plan_it, start
from tests.builds.test_context_api import full_options
from tests.conftest import AUTH

API = "/api/v1"
FOLDER = "papers/attention"
REPOS = [
    {"full_name": "octo/site", "description": "My website", "visibility": "PUBLIC",
     "default_branch": "main", "updated_at": "2026-10-01T00:00:00Z", "can_push": True},
    {"full_name": "acme/lab", "description": None, "visibility": "PRIVATE",
     "default_branch": "dev", "updated_at": None, "can_push": False},
]  # fmt: skip


@pytest.fixture
def gh() -> FakeGitHub:
    return FakeGitHub(
        listed=REPOS, info={"octo/site": RepoInfo("main", False, "WRITE")},
        branch_names={"octo/site": ["main"]},
        trees={"octo/site": [("blob", "README.md"), ("blob", "package.json")]},
        files={("octo/site", "README.md"): "# Site"},
    )  # fmt: skip


@pytest.fixture
def api(client: TestClient, gh: FakeGitHub) -> Iterator[TestClient]:
    app = client.app
    assert isinstance(app, FastAPI)
    app.dependency_overrides[get_probe] = FakeProbe
    app.dependency_overrides[get_github] = lambda: gh
    yield client
    app.dependency_overrides.clear()


def local(path: Path, **fields: object) -> dict:
    return {"kind": "local", "path": str(path), "folder": FOLDER, **fields}


def existing_options(target: dict) -> dict:
    """As the form sends them for an existing repository (docs/BUILDS.md §7c)."""
    options = full_options(target=target, repo_name=None, visibility="local")
    options["advanced"] = {**options["advanced"], "delivery": "push_main", "license": "none"}
    return options


def test_repos_are_listed_and_filtered(api: TestClient, gh: FakeGitHub) -> None:
    every = api.get(f"{API}/builds/repos", headers=AUTH, params={"q": ""})
    some = api.get(f"{API}/builds/repos", headers=AUTH, params={"q": "website"})

    assert every.status_code == 200 and every.json() == REPOS
    assert [r["full_name"] for r in some.json()] == ["octo/site"]
    assert gh.list_calls == 1  # cached


def test_repos_without_a_gh_login_are_a_409(api: TestClient, gh: FakeGitHub) -> None:
    gh.logged_in = False

    assert api.get(f"{API}/builds/repos", headers=AUTH, params={"q": ""}).status_code == 409


def test_inspect_takes_the_bare_target(api: TestClient, tmp_path: Path) -> None:
    repo = make_user_repo(tmp_path, extra={f"{FOLDER}/old.md": "x"})

    response = api.post(f"{API}/builds/target/inspect", headers=AUTH, json=local(repo))
    github = api.post(f"{API}/builds/target/inspect", headers=AUTH,
                      json={"kind": "github", "repo": "octo/site", "folder": FOLDER})  # fmt: skip

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"ok", "problems", "default_branch", "branches", "folder_exists",
                         "folder_empty", "survey"}  # fmt: skip
    assert body["ok"] is False and body["folder_exists"] and not body["folder_empty"]
    assert [p["key"] for p in body["problems"]] == ["target_folder"]
    assert set(body["problems"][0]) == {"key", "ok", "level", "message", "fix"}
    assert body["survey"]["tree"][:3] == ["CLAUDE.md", "README.md", "papers/"]
    assert github.json()["ok"] and github.json()["survey"]["toolchains"] == ["node"]


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", "builds/repos?q="), ("get", "builds/preflight?document=x"),
     ("post", "builds/target/inspect"), ("post", "papers/x/builds/context/render")],
)  # fmt: skip
def test_routes_that_read_the_machine_need_the_key(
    api: TestClient, tmp_path: Path, method: str, path: str
) -> None:
    """They run git and gh on a path or repo the caller names: a key, like any write."""
    body = local(make_user_repo(tmp_path)) if path.endswith("inspect") else {"options": {}}
    kwargs = {"json": body} if method == "post" else {}

    assert getattr(api, method)(f"{API}/{path}", **kwargs).status_code == 401


@pytest.mark.parametrize(
    "body",
    [{"kind": "new"}, {"kind": "local", "path": "rel/x", "folder": FOLDER},
     {"kind": "github", "repo": "octo/site", "folder": "../x"}],
)  # fmt: skip
def test_inspect_refuses_what_it_cannot_inspect(api: TestClient, body: dict) -> None:
    assert api.post(f"{API}/builds/target/inspect", headers=AUTH, json=body).status_code == 422


def test_a_local_create_resolves_the_base_and_its_context_shows_the_folder(
    api: TestClient, session: Session, tmp_path: Path
) -> None:
    repo = make_user_repo(tmp_path)
    paper = known_paper(session)

    build = start(api, paper.slug, options=existing_options(local(repo)))
    plan_it(session, build["id"])
    view = api.get(f"{API}/builds/{build['id']}/context").json()

    assert build["options"]["target"]["base_branch"] == "main"
    assert build["repo_url"] is None and build["options"]["repo_name"] is None
    paths = [f["path"] for f in view["files"]]
    assert paths[:3] == [f"{FOLDER}/README.md", f"{FOLDER}/docs/PAPER.md", f"{FOLDER}/docs/PLAN.md"]
    assert view["survey_md"].startswith(f"# Repository\n\n`{repo}` at `main`.")
    assert "Use ruff." in view["survey_md"]
    assert f"Write({FOLDER}/**)" in view["allowed_tools"]
    assert view["plan_input"]["repository"] == {
        "kind": "local",
        "repo": str(repo),
        "folder": FOLDER,
        "survey_md": view["survey_md"],
    }


def test_a_create_into_a_taken_folder_is_a_409(
    api: TestClient, session: Session, tmp_path: Path
) -> None:
    repo = make_user_repo(tmp_path, extra={f"{FOLDER}/old.md": "x"})
    paper = known_paper(session)

    response = api.post(f"{API}/papers/{paper.slug}/builds", headers=AUTH,
                        json={"goal": "A minimal build of the gated reader.",
                              "options": existing_options(local(repo))})  # fmt: skip
    assert response.status_code == 409
    assert "target_folder" in [d["key"] for d in response.json()["error"]["details"]]


def test_a_github_create_points_at_the_repo_and_defaults_to_a_pull_request(
    api: TestClient, session: Session
) -> None:
    paper = known_paper(session)
    options = full_options(target={"kind": "github", "repo": "octo/site", "folder": FOLDER},
                           repo_name=None)  # fmt: skip

    build = start(api, paper.slug, options=options)

    assert build["repo_url"] == "https://github.com/octo/site"
    assert build["options"]["advanced"]["delivery"] == "push_main"  # the form sent it
    rendered = api.post(f"{API}/papers/{paper.slug}/builds/context/render", headers=AUTH,
                        json={"options": {"target": options["target"]}}).json()  # fmt: skip
    assert rendered["survey_md"].startswith("# Repository\n\n`octo/site` at `main`.")
    assert rendered["files"][0]["path"] == f"{FOLDER}/docs/PAPER.md"
    assert "You work on the branch `build/attention`" in rendered["kickoff"]


def test_the_planner_input_carries_the_survey(session: Session, tmp_path: Path) -> None:
    repo = make_user_repo(tmp_path)
    paper = known_paper(session)
    build = Build(document_id=paper.id, goal="A minimal build of the gated reader.",
                  options={"target": local(repo, base_branch="main")},
                  stops={"max_minutes": 90, "max_commits": 30})  # fmt: skip

    got = planning.plan_input(session, build, paper)["repository"]

    assert (got["kind"], got["repo"], got["folder"]) == ("local", str(repo), FOLDER)
    assert "- Python (pyproject.toml)" in got["survey_md"] and "Use ruff." in got["survey_md"]
    new = Build(document_id=paper.id, goal="g" * 12, options={"repo_name": "x"},
                stops={"max_minutes": 90, "max_commits": 30})  # fmt: skip
    assert planning.plan_input(session, new, paper)["repository"] is None
