"""Preflight: each check on a fake machine, and the paper checks on real shelf data."""

from pathlib import Path

import pytest
from sqlmodel import Session

from app.builds import preflight as pf
from app.core.config import get_settings
from app.models.build import BuildVisibility
from app.models.enums import Review
from tests.builds.factories import FakeProbe, known_paper


def by_key(result: pf.Preflight) -> dict[str, pf.PreflightCheck]:
    return {c.key: c for c in result.checks}


def run(session: Session, probe: FakeProbe, **paper: object) -> dict[str, pf.PreflightCheck]:
    doc = known_paper(session, **paper)  # type: ignore[arg-type]
    return by_key(pf.preflight(session, doc, visibility=BuildVisibility.PRIVATE, probe=probe))


def test_a_ready_machine_and_a_known_paper_pass_every_check(session: Session):
    paper = known_paper(session)
    result = pf.preflight(session, paper, visibility=BuildVisibility.PRIVATE, probe=FakeProbe())

    assert result.ready
    assert [c.key for c in result.checks] == [
        "claude_cli", "git_cli", "git_identity", "gh_cli", "gh_auth", "gh_scope", "workspace",
        "paper_card", "claims", "results", "explainer",
    ]  # fmt: skip
    assert all(c.ok and c.fix is None for c in result.checks)


def test_local_builds_skip_the_github_checks(session: Session):
    probe = FakeProbe(missing=["gh"])
    result = pf.preflight(session, known_paper(session), visibility=BuildVisibility.LOCAL,
                          probe=probe)  # fmt: skip

    assert result.ready
    assert not {"gh_cli", "gh_auth", "gh_scope"} & set(by_key(result))
    assert not any(c[1:3] == ["auth", "status"] for c in probe.calls)


@pytest.mark.parametrize(
    ("probe", "key", "fix"),
    [
        (FakeProbe(missing=["/nonexistent/claude-must-be-faked-in-tests"]), "claude_cli", "claude"),
        (FakeProbe(missing=["git"]), "git_cli", "git-scm"),
        (FakeProbe(identity=("Ada", "")), "git_identity", "git config --global user.email"),
        (FakeProbe(missing=["/nonexistent/gh-must-be-faked-in-tests"]), "gh_cli", "cli.github.com"),
        (FakeProbe(gh_code=1), "gh_auth", "! gh auth login"),
        (FakeProbe(scopes="'gist', 'read:org'"), "gh_scope", "gh auth refresh -s repo"),
    ],
)
def test_each_machine_problem_blocks_with_its_fix(
    session: Session, probe: FakeProbe, key: str, fix: str
):
    checks = run(session, probe)

    assert not checks[key].ok and checks[key].level == "error"
    assert fix in (checks[key].fix or "")
    assert checks[key].message


def test_gh_scopes_are_read_from_the_status_output():
    assert pf.token_scopes("  - Token scopes: 'gist', 'repo'") == {"gist", "repo"}
    assert pf.token_scopes("✓ Logged in (keyring)") is None  # fine-grained: cannot tell


def test_an_unwritable_workspace_blocks(tmp_path: Path):
    blocker = tmp_path / "file"
    blocker.write_text("not a folder")

    check = pf.check_workspace(blocker / "builds")

    assert not check.ok and "BOOKSHELF_BUILD_WORKSPACE" in (check.fix or "")
    assert pf.check_workspace(tmp_path / "ok").ok


def test_no_card_blocks_and_a_draft_card_warns(session: Session):
    none = run(session, FakeProbe(), card=None)["paper_card"]
    draft = run(session, FakeProbe(), card=Review.DRAFT)["paper_card"]

    assert (none.ok, none.level) == (False, "error")
    assert (draft.ok, draft.level) == (False, "warning")
    assert "Approve the paper card in Review" in (draft.fix or "")


def test_missing_claims_results_and_explainer_only_warn(session: Session):
    paper = known_paper(session, claims=False, results=False, explainer_levels=())
    result = pf.preflight(session, paper, visibility=BuildVisibility.PRIVATE, probe=FakeProbe())
    checks = by_key(result)

    assert result.ready
    for key in ("claims", "results", "explainer"):
        assert (checks[key].ok, checks[key].level) == (False, "warning")
    assert "Run Simplify in the Explain tab" in (checks["explainer"].fix or "")


def test_the_real_probe_checks_are_cached(monkeypatch: pytest.MonkeyPatch):
    calls: list[bool] = []

    def fake(probe: object, settings: object, *, github: bool) -> list[pf.PreflightCheck]:
        calls.append(github)
        return []

    monkeypatch.setattr(pf, "machine_checks", fake)
    pf.clear_cache()
    clock = iter([0.0, 10.0, 100.0])
    for _ in range(3):
        pf.cached_machine_checks(get_settings(), github=True, clock=lambda: next(clock))
    pf.clear_cache()

    assert calls == [True, True]  # the second ask within a minute was remembered
