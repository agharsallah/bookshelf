"""Closed vocabularies. Each mirrors a `check (... in (...))` constraint in
`supabase/migrations/`; change both in the same commit."""

from enum import StrEnum


class DocumentKind(StrEnum):
    PDF = "pdf"
    ARTICLE = "article"


class DocumentStatus(StrEnum):
    """Pipeline state machine (§7)."""

    REGISTERED = "registered"
    PARSING = "parsing"
    PARSE_FAILED = "parse_failed"
    PARSED = "parsed"
    NEEDS_REVIEW = "needs_review"
    ENRICHING = "enriching"
    DISTILLING = "distilling"
    DISTILLED = "distilled"
    INDEXED = "indexed"
    LINKED = "linked"
    DERIVING = "deriving"


class NodeKind(StrEnum):
    PART = "part"
    CHAPTER = "chapter"
    SECTION = "section"
    PARAGRAPH = "paragraph"
    LIST = "list"
    TABLE = "table"
    FIGURE = "figure"
    CODE = "code"
    MATH = "math"
    ASIDE = "aside"
    QUOTE = "quote"

    @property
    def is_container(self) -> bool:
        return self in _CONTAINERS


_CONTAINERS = frozenset({NodeKind.PART, NodeKind.CHAPTER, NodeKind.SECTION})


class NoteColor(StrEnum):
    AMBER = "amber"
    ROSE = "rose"
    SAGE = "sage"
    SKY = "sky"
    VIOLET = "violet"


class NoteTarget(StrEnum):
    """What a note marks: the source text, or a passage of a chapter's reading pane."""

    SOURCE = "source"
    CHAPTER_DISTILLATION = "chapter_distillation"
    CHAPTER_SUMMARY = "chapter_summary"


class ArtifactType(StrEnum):
    OUTLINE_OVERRIDE = "outline_override"
    FIGURE_DESCRIPTION = "figure_description"
    CODE_EXPLANATION = "code_explanation"
    MATH_DESCRIPTION = "math_description"
    TABLE_EXPLANATION = "table_explanation"
    CHAPTER_SUMMARY = "chapter_summary"
    BOOK_SUMMARY = "book_summary"
    SECTION_NOTE = "section_note"
    CHAPTER_DISTILLATION = "chapter_distillation"
    BOOK_BRIEF = "book_brief"
    BOOK_GUIDE = "book_guide"
    STRUCTURED_NOTE = "structured_note"
    CONCEPT_LINKS = "concept_links"
    QUOTE_SET = "quote_set"
    FAQ = "faq"
    QUIZ = "quiz"
    FLASHCARDS = "flashcards"
    GLOSSARY = "glossary"
    AUDIO_SUMMARY = "audio_summary"


class Origin(StrEnum):
    HUMAN = "human"
    SKILL = "skill"


class RunMode(StrEnum):
    BATCH = "batch"
    INTERACTIVE = "interactive"


class Tier(StrEnum):
    """Model ladder (D16). Mapped to CLI aliases in `app/pipeline/models.py` only."""

    EXPLORE = "explore"
    DISTIL = "distil"
    REASON = "reason"


class Review(StrEnum):
    DRAFT = "draft"
    NEEDS_REVIEW = "needs_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class ConceptKind(StrEnum):
    CONCEPT = "concept"
    FRAMEWORK = "framework"
    PERSON = "person"
    WORK = "work"
    TERM = "term"


class EntityKind(StrEnum):
    """Endpoints of a polymorphic edge."""

    NODE = "node"
    CONCEPT = "concept"
    ARTIFACT = "artifact"
    DOCUMENT = "document"


class Relation(StrEnum):
    MENTIONS = "mentions"
    DEFINES = "defines"
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    EXTENDS = "extends"
    EXAMPLE_OF = "example_of"
    SAME_AS = "same_as"


class EdgeStatus(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class JobKind(StrEnum):
    PARSE = "parse"
    DESCRIBE_FIGURE = "describe_figure"
    EXPLAIN_CODE = "explain_code"
    DESCRIBE_MATH = "describe_math"
    EXPLAIN_TABLE = "explain_table"
    SUMMARIZE = "summarize"
    DISTIL_SECTION = "distil_section"
    DISTIL_CHAPTER = "distil_chapter"
    BRIEF = "brief"
    STRUCTURE_NOTE = "structure_note"
    EMBED = "embed"
    LINK_CONCEPTS = "link_concepts"
    DERIVE = "derive"
    EXPORT = "export"
    NARRATE = "narrate"


class JobState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"
