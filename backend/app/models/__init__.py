"""Table models. Importing this package registers every table's metadata."""

from app.models.activity import ActivityMinute
from app.models.app_settings import AppSettings
from app.models.artifact import Artifact
from app.models.document import Document, Node
from app.models.graph import Concept, Edge, node_ref
from app.models.job import Job
from app.models.model_run import ModelRun
from app.models.note import Note
from app.models.paper import (
    Claim,
    PaperMeta,
    PaperPass,
    PaperRating,
    PaperReference,
    PaperSet,
    PaperSynthesis,
    ReadingCandidate,
)
from app.models.reading import ReadingPosition
from app.models.recall import Recall, RecallGrade, ReviewItem, ReviewLog
from app.models.worker import WorkerRow

__all__ = [
    "ActivityMinute",
    "AppSettings",
    "Artifact",
    "Claim",
    "Concept",
    "Document",
    "Edge",
    "Job",
    "ModelRun",
    "Node",
    "Note",
    "PaperMeta",
    "PaperPass",
    "PaperRating",
    "PaperReference",
    "PaperSet",
    "PaperSynthesis",
    "ReadingCandidate",
    "ReadingPosition",
    "Recall",
    "RecallGrade",
    "ReviewItem",
    "ReviewLog",
    "WorkerRow",
    "node_ref",
]
