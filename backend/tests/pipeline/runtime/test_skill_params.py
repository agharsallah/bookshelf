"""Run parameters on a skill package: `params`, `variant`, and resolving what a job asked for."""

from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.pipeline.skills import ParamError, SkillMeta, load_catalogue
from tests.pipeline.runtime.conftest import AUDIO_META, AUDIO_SKILL, write_audio_skill

BASE = {"name": AUDIO_SKILL, "version": 1, **AUDIO_META}
META = SkillMeta.model_validate(BASE)
DEFAULTS = {"minutes": 15, "format": "conversation", "language": "en"}


def meta(**overrides: Any) -> SkillMeta:
    return SkillMeta.model_validate({**BASE, **overrides})


def test_every_param_left_out_takes_its_default():
    assert META.resolve_params(None) == DEFAULTS
    assert META.resolve_params({"format": "panel"}) == {**DEFAULTS, "format": "panel"}


def test_a_value_is_matched_by_its_text_so_a_query_string_picks_the_number():
    resolved = META.resolve_params({"minutes": "5"})

    assert resolved["minutes"] == 5
    assert type(resolved["minutes"]) is int


def test_an_undeclared_param_is_refused_and_named():
    with pytest.raises(ParamError, match="takes no param 'speed'") as caught:
        META.resolve_params({"minutes": 5, "speed": 2})

    assert caught.value.param == "speed"


@pytest.mark.parametrize(
    ("params", "name"),
    [
        ({"minutes": 7}, "minutes"),
        ({"minutes": "fifteen"}, "minutes"),
        ({"format": "Panel"}, "format"),
        ({"minutes": True}, "minutes"),
    ],
    ids=["not-a-choice", "not-a-number", "case-matters", "bool"],
)
def test_a_value_outside_the_choices_is_refused_and_named(params, name):
    with pytest.raises(ParamError, match="must be one of") as caught:
        META.resolve_params(params)

    assert caught.value.param == name


def test_a_bool_never_passes_for_a_choice_that_reads_the_same():
    flagged = meta(
        params={"loud": {"choices": ["True", "False"], "default": "False"}}, variant="{loud}"
    )

    assert flagged.resolve_params({"loud": "True"}) == {"loud": "True"}
    with pytest.raises(ParamError):
        flagged.resolve_params({"loud": True})


def test_variant_names_the_episode_and_params_of_reverses_it():
    params = META.resolve_params({"minutes": 30, "format": "panel", "language": "zh"})

    assert META.variant_of(params) == "30m-panel-zh"
    assert META.params_of("30m-panel-zh") == params


@pytest.mark.parametrize("variant", ["45m-panel-zh", "30m-panel", "", None])
def test_params_of_an_episode_no_choices_make_is_none(variant):
    assert META.params_of(variant) is None


def test_a_skill_without_params_has_no_variant_and_takes_nothing():
    plain = meta(params={}, variant=None, narrate=False)

    assert plain.resolve_params(None) == {}
    assert plain.variant_of({}) is None
    assert plain.params_of("15m-conversation-en") is None
    with pytest.raises(ParamError):
        plain.resolve_params({"minutes": 5})


@pytest.mark.parametrize(
    "overrides",
    [
        {"variant": None},
        {"params": {}},
        {"variant": "{minutes}m-{speed}"},
        {"variant": "episode"},
        {"params": {"minutes": {"choices": [5, 15], "default": 30}}, "variant": "{minutes}m"},
        {"params": {"minutes": {"choices": [], "default": 5}}, "variant": "{minutes}m"},
    ],
    ids=[
        "params-without-variant",
        "variant-without-params",
        "variant-names-an-undeclared-param",
        "variant-names-no-param",
        "default-not-a-choice",
        "no-choices",
    ],
)
def test_malformed_params_or_variant_are_refused(overrides):
    with pytest.raises(ValidationError):
        meta(**overrides)


def test_catalogue_loads_a_narrated_package_with_numeric_choices(tmp_path: Path):
    write_audio_skill(tmp_path)

    loaded = load_catalogue(tmp_path)[AUDIO_SKILL].meta

    assert loaded.narrate is True
    assert loaded.params["minutes"].choices == (5, 15, 30)
    assert loaded.gates.words_per_minute == (115, 185)


def test_catalogue_skips_a_package_whose_variant_names_an_undeclared_param(tmp_path: Path):
    write_audio_skill(tmp_path, variant="{minutes}m-{voice}")

    assert AUDIO_SKILL not in load_catalogue(tmp_path)
