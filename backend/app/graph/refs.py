"""One id scheme for graph endpoints and evidence.

Edges store an endpoint as `(kind, id)`: `id` is a uuid string, or `<document_id>#<anchor>`
for a node (`app.models.graph.node_ref`, stable across re-parses). The API and the
neighborhood speak the same thing as one string, `<kind>:<id>`:

    concept:3f1c…            document:9a2e…            artifact:77b0…
    node:9a2e…#ch03/s02/p014

Evidence entries are *qualified anchors*, `<document_id>#<anchor>`, exactly a node id. A
skill cites document-local anchors; `apply` qualifies them, so one concept can carry
evidence from several books and an evidence list is resolvable on its own. `?node=` also
accepts a bare uuid (concept, then document, then artifact) or a bare qualified anchor.
"""

import re
import uuid
from dataclasses import dataclass

from sqlmodel import Session, select

from app.models import Artifact, Concept, Document, Node, node_ref
from app.models.enums import EntityKind

ANCHOR = re.compile(r"^[a-z]+[0-9]+(/[a-z]+[0-9]+)*$")


class RefError(ValueError):
    """A string that is not a graph ref, or names nothing that exists."""


@dataclass(frozen=True, slots=True)
class Ref:
    kind: EntityKind
    id: str

    def __str__(self) -> str:
        return f"{self.kind.value}:{self.id}"

    @classmethod
    def concept(cls, concept_id: uuid.UUID) -> "Ref":
        return cls(EntityKind.CONCEPT, str(concept_id))

    @classmethod
    def node(cls, document_id: uuid.UUID, anchor: str) -> "Ref":
        return cls(EntityKind.NODE, node_ref(document_id, anchor))

    @property
    def uuid(self) -> uuid.UUID:
        """The row id (for a node: its document's id)."""
        return uuid.UUID(self.id.split("#", 1)[0])

    @property
    def anchor(self) -> str | None:
        return self.id.split("#", 1)[1] if self.kind is EntityKind.NODE else None


def split_anchor(qualified: str) -> tuple[uuid.UUID, str] | None:
    """`<document_id>#<anchor>` → its parts, or None when malformed."""
    doc, sep, anchor = qualified.partition("#")
    if not sep or not ANCHOR.match(anchor):
        return None
    try:
        return uuid.UUID(doc), anchor
    except ValueError:
        return None


def document_prefix(document_id: uuid.UUID) -> str:
    """LIKE pattern matching every qualified anchor of one document."""
    return f"{document_id}#%"


def parse_ref(value: str) -> Ref | uuid.UUID:
    """Syntax only. A bare uuid comes back as a `uuid.UUID`: its kind needs a lookup."""
    value = value.strip()
    kind, sep, rest = value.partition(":")
    if sep and kind in EntityKind.__members__.values():
        entity = EntityKind(kind)
        if entity is EntityKind.NODE:
            if split_anchor(rest) is None:
                raise RefError(f"{value!r} is not node:<document_id>#<anchor>")
            return Ref(entity, rest)
        try:
            return Ref(entity, str(uuid.UUID(rest)))
        except ValueError as exc:
            raise RefError(f"{value!r} does not carry a uuid") from exc
    if split_anchor(value) is not None:
        return Ref(EntityKind.NODE, value)
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise RefError(
            f"{value!r} is not a graph ref (concept:<id>, node:<doc>#<anchor>, "
            "document:<id>, artifact:<id>, or a bare id)"
        ) from exc


def node_exists(session: Session, ref: Ref) -> bool:
    found = session.exec(
        select(Node.id).where(Node.document_id == ref.uuid, Node.anchor == ref.anchor)
    ).first()
    return found is not None


def survivor(session: Session, concept: Concept) -> Concept:
    """Follow `merged_into` to the concept that stands for this one (bounded)."""
    seen = {concept.id}
    while concept.merged_into is not None and concept.merged_into not in seen:
        target = session.get(Concept, concept.merged_into)
        if target is None:
            break
        seen.add(target.id)
        concept = target
    return concept


def resolve_ref(session: Session, value: str) -> Ref:
    """A ref that names an existing row. Merged concepts resolve to their survivor.

    Raises `RefError` when the syntax is wrong or nothing matches.
    """
    parsed = parse_ref(value)
    candidates: list[EntityKind]
    if isinstance(parsed, uuid.UUID):
        row_id = parsed
        candidates = [EntityKind.CONCEPT, EntityKind.DOCUMENT, EntityKind.ARTIFACT]
    else:
        row_id = parsed.uuid
        candidates = [parsed.kind]
    for kind in candidates:
        if kind is EntityKind.CONCEPT and (concept := session.get(Concept, row_id)) is not None:
            return Ref.concept(survivor(session, concept).id)
        if kind is EntityKind.DOCUMENT and session.get(Document, row_id) is not None:
            return Ref(kind, str(row_id))
        if kind is EntityKind.ARTIFACT and session.get(Artifact, row_id) is not None:
            return Ref(kind, str(row_id))
        if kind is EntityKind.NODE and isinstance(parsed, Ref) and node_exists(session, parsed):
            return parsed
    raise RefError(f"{value!r} names nothing in the graph")
