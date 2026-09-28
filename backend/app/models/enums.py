"""Closed vocabularies. Each mirrors a `check (... in (...))` constraint in
`supabase/migrations/`; change both in the same commit."""

from enum import StrEnum


class DocumentKind(StrEnum):
    PDF = "pdf"
    EPUB = "epub"
    ARTICLE = "article"


class Genre(StrEnum):
    """What a document is, as opposed to its file format (`DocumentKind`). Papers P1."""

    BOOK = "book"
    PAPER = "paper"
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


class RecallKind(StrEnum):
    """What a recall holds: the chapter from memory, or what you expected it to argue."""

    RECALL = "recall"
    PREDICTION = "prediction"


class ReviewSource(StrEnum):
    """Where a review item came from (its `source_key` is unique within the source)."""

    RECALL = "recall"  # an idea a recall missed or half-recalled
    QUESTION = "question"  # the "why is this true?" a graded recall asked
    FLASHCARD = "flashcard"  # a flashcard you marked


class Surface(StrEnum):
    """Where attention went (`activity_minutes.surface`)."""

    READ = "read"  # the source text in the reader
    LISTEN = "listen"  # a recording playing: a chapter read aloud or an episode
    STUDY = "study"  # quiz, flashcards, FAQ, glossary, quotes
    RECALL = "recall"  # writing a chapter from memory, or a prediction
    REVIEW = "review"  # spaced reviews
    DISTILL = "distill"  # the brief, the guide: what the pipeline wrote
    EXPLORE = "explore"  # search, the concept graph, the map


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
    SALIENCE_MARKS = "salience_marks"
    # Papers (docs/PAPERS.md §4)
    PAPER_CARD = "paper_card"  # dissect-paper: the paper's brief
    PAPER_EXPLAINER = "paper_explainer"  # simplify-paper, variant = level
    CLAIM_SET = "claim_set"  # extract-claims → materialized into `claims`
    RESULTS_TABLE = "results_table"  # extract-results
    CITATION_INTENTS = "citation_intents"  # classify-citations → paper_references.intent
    PAPER_ASSESSMENT = "paper_assessment"  # assess-paper (the model's verdict, P8)
    PAPER_REVIEW = "paper_review"  # review-paper: peer-review report
    NOTATION_TABLE = "notation_table"  # make-notation
    JOURNAL_CLUB = "journal_club"  # make-journal-club


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
    # Papers: written by link-paper-concepts only (link-concepts keeps the five above).
    METHOD = "method"
    DATASET = "dataset"
    METRIC = "metric"
    TASK = "task"

    @property
    def is_paper_only(self) -> bool:
        """A kind only paper skills propose (`link-paper-concepts`)."""
        return self in _PAPER_CONCEPT_KINDS


_PAPER_CONCEPT_KINDS = frozenset(
    {ConceptKind.METHOD, ConceptKind.DATASET, ConceptKind.METRIC, ConceptKind.TASK}
)


class EntityKind(StrEnum):
    """Endpoints of a polymorphic edge."""

    NODE = "node"
    CONCEPT = "concept"
    ARTIFACT = "artifact"
    DOCUMENT = "document"
    CLAIM = "claim"  # a row of `claims`; the ref id is the claim uuid


class Relation(StrEnum):
    MENTIONS = "mentions"
    DEFINES = "defines"
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    EXTENDS = "extends"
    EXAMPLE_OF = "example_of"
    SAME_AS = "same_as"
    ECHOES = "echoes"  # chapters whose passages say similar things (app.graph.semantic)
    CITES = "cites"  # document → document, from paper_references.target_document_id

    @property
    def is_derived(self) -> bool:
        """Computed by Python (from vectors or the bibliography), never proposed by a skill."""
        return self in (Relation.ECHOES, Relation.CITES)


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
    GRADE_RECALL = "grade_recall"
    # Papers (docs/PAPERS.md §3-§5). Stage skills: the kind picks the skill package.
    DISTIL_PAPER_SECTION = "distil_paper_section"  # distil-paper-section → chapter_distillation
    DISSECT_PAPER = "dissect_paper"  # dissect-paper → paper_card (replaces `brief`)
    LINK_PAPER_CONCEPTS = "link_paper_concepts"  # link-paper-concepts → concept_links
    # Python jobs (some run a utility skill inline, like grade_recall).
    PAPER_STRUCTURE = "paper_structure"  # roles, paper_meta, bibliography, in-text cites
    PAPER_ENRICH = "paper_enrich"  # OpenAlex metadata
    PAPER_CANDIDATES = "paper_candidates"  # rebuild + score reading_candidates
    PAPER_WATCH = "paper_watch"  # new works citing watched papers → candidates
    PAPER_FETCH = "paper_fetch"  # download a candidate's open-access PDF and ingest it
    RELATE_CLAIMS = "relate_claims"  # relate-claims utility skill → claim ↔ claim edges
    RECOMMEND_NEXT = "recommend_next"  # recommend-next utility skill → candidate reasons
    SYNTHESIZE_PAPERS = "synthesize_papers"  # synthesize-papers utility skill → paper_syntheses


class JobState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


# Papers (docs/PAPERS.md §2): vocabularies of the paper tables.


class PaperMetaSource(StrEnum):
    """Who last wrote a `paper_meta` row."""

    PARSED = "parsed"
    OPENALEX = "openalex"
    GROBID = "grobid"
    HUMAN = "human"


class CitationIntent(StrEnum):
    """Why a paper cites a reference (`paper_references.intent`, classify-citations)."""

    BACKGROUND = "background"
    USES = "uses"
    EXTENDS = "extends"
    COMPARES = "compares"
    CONTRADICTS = "contradicts"


class ClaimKind(StrEnum):
    METHOD = "method"
    RESULT = "result"
    THEORY = "theory"
    DATASET = "dataset"
    BENCHMARK = "benchmark"
    POSITION = "position"


class ClaimStrength(StrEnum):
    MEASURED = "measured"
    ARGUED = "argued"
    SPECULATED = "speculated"


class PaperVerdict(StrEnum):
    """Your one-word verdict next to the stars (`paper_ratings.verdict`, P8)."""

    MUST_READ = "must_read"
    USEFUL = "useful"
    SKIM = "skim"
    SKIP = "skip"


class CandidateStatus(StrEnum):
    SUGGESTED = "suggested"
    QUEUED = "queued"
    DISMISSED = "dismissed"
    INGESTED = "ingested"


class CandidateSource(StrEnum):
    """How a candidate reached the queue (`reading_candidates.sources[].kind`; jsonb, so
    enforced in Python only)."""

    REFERENCE = "reference"  # a shelf paper cites it (backward)
    CITED_BY = "cited_by"  # it cites a shelf paper (forward, OpenAlex)
    RELATED = "related"  # OpenAlex related_works
    SIMILAR = "similar"  # abstract-embedding neighbour of a paper you rated >= 4
    WATCH = "watch"  # new work citing a watched paper


# Paper vocabularies without a DB column: they live in `nodes.meta` or in skill outputs
# (the skill schema enforces them), listed here so every layer names them the same way.


class SectionRole(StrEnum):
    """`meta.role` of a paper's top-level section (papers.structure)."""

    ABSTRACT = "abstract"
    INTRODUCTION = "introduction"
    RELATED_WORK = "related_work"
    BACKGROUND = "background"
    METHOD = "method"
    EXPERIMENTS = "experiments"
    RESULTS = "results"
    DISCUSSION = "discussion"
    LIMITATIONS = "limitations"
    CONCLUSION = "conclusion"
    REFERENCES = "references"
    APPENDIX = "appendix"
    OTHER = "other"


class ExplainerLevel(StrEnum):
    """simplify-paper `level` param; the `paper_explainer` variant."""

    NEWCOMER = "newcomer"
    PRACTITIONER = "practitioner"
    EXPERT = "expert"


class AssessmentCriterion(StrEnum):
    """assess-paper score criteria (each 1-5)."""

    NOVELTY = "novelty"
    RIGOUR = "rigour"
    EVIDENCE = "evidence"
    CLARITY = "clarity"
    REPRODUCIBILITY = "reproducibility"
    RELEVANCE = "relevance"


class ReproducibilityStatus(StrEnum):
    """assess-paper reproducibility checklist item status."""

    YES = "yes"
    PARTIAL = "partial"
    NO = "no"
    UNKNOWN = "unknown"
