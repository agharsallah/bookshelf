"""Table models. Importing this package registers every table's metadata."""

from app.models.artifact import Artifact
from app.models.document import Document, Node
from app.models.graph import Concept, Edge, node_ref
from app.models.job import Job
from app.models.note import Note
from app.models.reading import ReadingPosition
from app.models.recall import Recall, RecallGrade, ReviewItem, ReviewLog
from app.models.worker import WorkerRow

__all__ = [
    "Artifact",
    "Concept",
    "Document",
    "Edge",
    "Job",
    "Node",
    "Note",
    "ReadingPosition",
    "Recall",
    "RecallGrade",
    "ReviewItem",
    "ReviewLog",
    "WorkerRow",
    "node_ref",
]
