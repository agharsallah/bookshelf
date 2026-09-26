"""Dependencies and error translation shared by the artifacts and skills routes."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, status

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.pipeline import interactive
from app.pipeline.artifacts import ArtifactExistsError
from app.pipeline.authoring import ReviewStateError
from app.pipeline.runner import OutputError
from app.pipeline.selectors import SelectorError
from app.pipeline.skills import ParamError
from app.services.errors import InvalidInputError


def get_skills_dir() -> Path:
    """Where skill packages live. A dependency, so tests can point it at a tmp dir."""
    return get_settings().skills_dir


SkillsDirDep = Annotated[Path, Depends(get_skills_dir)]


class GateRejectedError(AppError):
    """The body failed the hard gates (schema or anchor validity), or has no valid scope."""

    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "gate_rejected"


@contextmanager
def pipeline_errors() -> Iterator[None]:
    """Translate pipeline exceptions into the API's error envelope."""
    try:
        yield
    except OutputError as exc:
        raise GateRejectedError(
            "Output rejected by the quality gates.",
            [{"message": problem} for problem in exc.problems],
        ) from exc
    except ArtifactExistsError as exc:
        raise ConflictError(
            str(exc), [{"field": "input_hash", "artifact_id": str(exc.existing.id)}]
        ) from exc
    except ReviewStateError as exc:
        raise ConflictError(str(exc), [{"field": "action"}]) from exc
    except interactive.InputsChangedError as exc:
        raise ConflictError(str(exc), [{"field": "input_hash"}]) from exc
    except (interactive.UnknownSkillError, interactive.UnknownDocumentError) as exc:
        raise NotFoundError(str(exc)) from exc
    except SelectorError as exc:
        raise GateRejectedError(str(exc)) from exc
    except ParamError as exc:
        field = f"params.{exc.param}" if exc.param else "params"
        raise InvalidInputError(str(exc), field=field) from exc
