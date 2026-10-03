"""Build defaults in `/settings`, and the builds table against its Python vocabularies."""

import re
from enum import StrEnum

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.core.config import get_settings
from app.jobs.queue import own_slot_kinds
from app.models.build import BuildState, StopReason
from app.models.enums import JobKind
from tests.conftest import AUTH

API = "/api/v1/settings"
ADVANCED = {"model": "auto", "effort": "auto", "plan_model": "auto",
            "commit_style": "milestone", "tests": "each_milestone", "license": "none",
            "delivery": "push_main", "push": "each_commit"}  # fmt: skip
DEFAULTS = {"owner": None, "visibility": "private", "claude_attribution": False,
            "link_paper": True, "max_minutes": 90, "max_commits": 30,
            "max_budget_usd": None, "advanced": ADVANCED}  # fmt: skip


def test_a_new_install_has_the_default_build_settings(client: TestClient):
    assert client.get(API).json()["builds"] == DEFAULTS


def test_build_settings_merge_and_a_null_clears(client: TestClient):
    first = client.patch(API, json={"builds": {"owner": "acme", "max_budget_usd": 5}},
                         headers=AUTH)  # fmt: skip
    second = client.patch(API, json={"builds": {"visibility": "local", "max_budget_usd": None}},
                          headers=AUTH)  # fmt: skip

    assert first.status_code == 200 and first.json()["builds"]["max_budget_usd"] == 5
    assert second.json()["builds"] == {**DEFAULTS, "owner": "acme", "visibility": "local"}
    assert client.get(API).json()["auto_approve"] == "off"  # other settings untouched


@pytest.mark.parametrize(
    "bad",
    [{"max_minutes": 1}, {"max_commits": 0}, {"visibility": "secret"}, {"owner": "no spaces"},
     {"colour": "red"}],
)  # fmt: skip
def test_bad_build_settings_are_refused(client: TestClient, bad: dict):
    assert client.patch(API, json={"builds": bad}, headers=AUTH).status_code == 422


def _check_values(session: Session, name: str) -> set[str]:
    definition = session.execute(
        text("select pg_get_constraintdef(oid) from pg_constraint where conname = :n"), {"n": name}
    ).scalar_one()
    return set(re.findall(r"'([a-z_]+)'::text", definition))


@pytest.mark.parametrize(
    ("constraint", "enum"),
    [("builds_state_check", BuildState), ("builds_stop_reason_check", StopReason),
     ("jobs_kind_check", JobKind)],
)  # fmt: skip
def test_checks_mirror_the_enums(session: Session, constraint: str, enum: type[StrEnum]):
    assert _check_values(session, constraint) == {m.value for m in enum}


def test_a_build_run_never_holds_a_capped_slot():
    uncapped = own_slot_kinds(get_settings())
    assert JobKind.BUILD_RUN in uncapped and JobKind.BUILD_PLAN not in uncapped
