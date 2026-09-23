"""Model ladder (D16): the one place that names Claude Code CLI model aliases.

Skills declare a *tier* in `meta.yaml`; this table turns it into a `claude --model` alias.
The CLI resolves the alias to a concrete model, and the runner records that resolved name
in `artifacts.model`, so promoting a skill up a tier is a one-line change here or in its
meta.yaml whose effect on the gate scores is visible in the artifacts table.
"""

from app.models.enums import Tier

CLI_ALIASES: dict[Tier, str] = {
    Tier.EXPLORE: "haiku",
    Tier.DISTIL: "sonnet",
    Tier.REASON: "opus",
}


def cli_alias(tier: Tier) -> str:
    """The `claude --model` alias for a tier."""
    return CLI_ALIASES[tier]
