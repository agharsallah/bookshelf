"""Model ladder (D16): the one place that names Claude Code CLI model aliases.

Skills declare a *tier* in `meta.yaml`; this table turns it into a `claude --model` alias.
The CLI resolves the alias to a concrete model, and the runner records that resolved name
in `artifacts.model`, so promoting a skill up a tier is a one-line change here or in its
meta.yaml whose effect on the gate scores is visible in the artifacts table.

`BOOKSHELF_MODEL_EXPLORE` / `_DISTIL` / `_REASON` override a rung without a code change
(e.g. a whole book on `haiku`), and `BOOKSHELF_EFFORT_<TIER>` sets how hard that rung
thinks (`claude --effort`, `medium` by default). Neither changes a skill's `input_hash`, so existing artifacts
are kept; force a re-run to redo them on the new model or effort.
"""

from app.core.config import Effort, Settings, get_settings
from app.models.enums import Tier

CLI_ALIASES: dict[Tier, str] = {
    Tier.EXPLORE: "haiku",
    Tier.DISTIL: "sonnet",
    Tier.REASON: "opus",
}


def cli_alias(tier: Tier, settings: Settings | None = None) -> str:
    """The `claude --model` value for a tier: its settings override, else the ladder."""
    settings = settings or get_settings()
    overrides = {
        Tier.EXPLORE: settings.model_explore,
        Tier.DISTIL: settings.model_distil,
        Tier.REASON: settings.model_reason,
    }
    return overrides[tier] or CLI_ALIASES[tier]


def cli_effort(tier: Tier, settings: Settings | None = None) -> Effort:
    """The `claude --effort` value for a tier: its setting, `medium` unless changed."""
    settings = settings or get_settings()
    return {
        Tier.EXPLORE: settings.effort_explore,
        Tier.DISTIL: settings.effort_distil,
        Tier.REASON: settings.effort_reason,
    }[tier]
