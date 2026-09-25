"""Model ladder: tiers map to CLI aliases, and settings can move a rung (or its effort)
without code."""

import pytest
from pydantic import ValidationError

from app.core.config import Effort, Settings
from app.models.enums import Tier
from app.pipeline.models import cli_alias, cli_effort


def _settings(**models: str) -> Settings:
    return Settings(_env_file=None, **models)  # type: ignore[call-arg]


@pytest.mark.parametrize(
    ("tier", "alias"), [(Tier.EXPLORE, "haiku"), (Tier.DISTIL, "sonnet"), (Tier.REASON, "opus")]
)
def test_unset_overrides_keep_the_ladder(tier: Tier, alias: str):
    assert cli_alias(tier, _settings()) == alias


def test_an_override_moves_only_its_own_tier():
    settings = _settings(model_distil="haiku", model_reason="claude-haiku-4-5-20251001")

    assert cli_alias(Tier.EXPLORE, settings) == "haiku"
    assert cli_alias(Tier.DISTIL, settings) == "haiku"
    assert cli_alias(Tier.REASON, settings) == "claude-haiku-4-5-20251001"


def test_a_blank_override_in_env_means_unset(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOOKSHELF_MODEL_REASON", "  ")

    assert cli_alias(Tier.REASON, Settings(_env_file=None)) == "opus"  # type: ignore[call-arg]


def test_every_tier_defaults_to_medium_effort():
    settings = _settings()

    assert [cli_effort(tier, settings) for tier in Tier] == [Effort.MEDIUM] * 3


def test_an_effort_applies_to_its_own_tier_only():
    settings = _settings(effort_explore="low", effort_reason="max")

    assert cli_effort(Tier.EXPLORE, settings) is Effort.LOW
    assert cli_effort(Tier.DISTIL, settings) is Effort.MEDIUM
    assert cli_effort(Tier.REASON, settings) is Effort.MAX


def test_a_blank_effort_in_env_keeps_medium(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOOKSHELF_EFFORT_DISTIL", " ")

    assert cli_effort(Tier.DISTIL, Settings(_env_file=None)) is Effort.MEDIUM  # type: ignore[call-arg]


def test_an_unknown_effort_fails_at_startup_not_silently_in_the_cli():
    """`claude --effort bogus` only warns and falls back; the setting must not."""
    with pytest.raises(ValidationError, match="effort_reason"):
        _settings(effort_reason="extreme")
