"""Model ladder: tiers map to CLI aliases, and settings can move a rung without code."""

import pytest

from app.core.config import Settings
from app.models.enums import Tier
from app.pipeline.models import cli_alias


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
