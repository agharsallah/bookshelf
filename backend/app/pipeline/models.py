"""Model ladder (D16): the one place that names a tier's model on each runtime.

Skills declare a *tier* in `meta.yaml`. Claude turns it into a `claude --model` alias;
Cursor turns it into a Cursor model id (Composer, unless a rung is overridden). The runner
records the name the runtime actually used in `artifacts.model`, so promoting a skill up
a tier is a one-line change here or in its meta.yaml whose effect on the gate scores is
visible in the artifacts table.

`BOOKSHELF_MODEL_EXPLORE` / `_DISTIL` / `_REASON` override a Claude rung, and
`BOOKSHELF_CURSOR_MODEL_<TIER>` a Cursor rung, without a code change. `BOOKSHELF_EFFORT_<TIER>`
sets how hard a Claude rung thinks (`claude --effort`, `medium` by default). None of these
change a skill's `input_hash`, so existing artifacts are kept; force a re-run to redo them.
"""

from app.core.config import Effort, Settings, get_settings
from app.models.enums import Tier

CLI_ALIASES: dict[Tier, str] = {
    Tier.EXPLORE: "haiku",
    Tier.DISTIL: "sonnet",
    Tier.REASON: "opus",
}

# Cursor's own model. Tiers stay in the skill; a rung moves only through its override.
CURSOR_MODELS: dict[Tier, str] = {
    Tier.EXPLORE: "composer-2.5",
    Tier.DISTIL: "composer-2.5",
    Tier.REASON: "composer-2.5",
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


def cursor_model(tier: Tier, settings: Settings | None = None) -> str:
    """The Cursor model id for a tier: its settings override, else Composer."""
    settings = settings or get_settings()
    overrides = {
        Tier.EXPLORE: settings.cursor_model_explore,
        Tier.DISTIL: settings.cursor_model_distil,
        Tier.REASON: settings.cursor_model_reason,
    }
    return overrides[tier] or CURSOR_MODELS[tier]


def cli_effort(tier: Tier, settings: Settings | None = None) -> Effort:
    """The `claude --effort` value for a tier: its setting, `medium` unless changed."""
    settings = settings or get_settings()
    return {
        Tier.EXPLORE: settings.effort_explore,
        Tier.DISTIL: settings.effort_distil,
        Tier.REASON: settings.effort_reason,
    }[tier]
