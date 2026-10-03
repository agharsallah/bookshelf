"""Reader statistics (`GET /reader-stats`, `GET /documents/{ref}/reader-stats`): how you read.

Time is seconds of attention as the browser's attention clock counted it (`activity_minutes`,
since `tracked_since`); everything else (progress, notes, recalls, reviews) comes from the
rows those actions already write, so it covers all history. Days and hours are in the
requested time zone. `days` narrows every dated figure to the last N days; progress, cards
due, book states and streaks are always as of now.
"""

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.models.enums import Surface


class SurfaceTime(BaseModel):
    surface: Surface
    seconds: int
    share: float = Field(description="Of all tracked seconds in scope, 0 to 1.")


class Totals(BaseModel):
    seconds: int = 0
    reading_seconds: int = 0
    listening_seconds: int = 0
    study_seconds: int = Field(default=0, description="Study, recall and review together.")
    active_days: int = Field(default=0, description="Days with tracked time or any action.")
    sessions: int = 0
    mean_session_seconds: int | None = None
    median_session_seconds: int | None = None
    longest_session_seconds: int | None = None
    current_streak: int = Field(
        default=0, description="Active days in a row, up to today, whatever the window."
    )
    longest_streak: int = Field(default=0, description="Over all history, whatever the window.")
    books_started: int = 0
    books_finished: int = 0
    chapters_finished: int = 0
    words_read: int = Field(default=0, description="Each chapter's words times its progress.")
    pages_read: int = 0
    words_per_minute: float | None = Field(
        default=None, description="Words read over reading minutes, in chapters with both."
    )
    notes: int = Field(default=0, description="Notes with your words.")
    highlights: int = Field(default=0, description="Plain highlights, no words.")
    words_written: int = Field(default=0, description="In notes, recalls and predictions.")
    recalls: int = 0
    predictions: int = 0
    reviews: int = 0
    retention: float | None = Field(default=None, description="Reviews not rated Again, 0 to 1.")


class DayPoint(BaseModel):
    date: date
    seconds: dict[Surface, int] = Field(default_factory=dict)
    notes: int = 0
    reviews: int = 0
    recalls: int = 0
    moves: int = Field(default=0, description="Chapters whose reading place last moved that day.")


class HourCell(BaseModel):
    weekday: int = Field(ge=0, le=6, description="Monday is 0.")
    hour: int = Field(ge=0, le=23)
    seconds: int


class HistogramBin(BaseModel):
    label: str
    low: int = Field(description="Lower bound, inclusive (seconds).")
    high: int | None = Field(description="Upper bound, exclusive; None is open-ended.")
    count: int


class Session(BaseModel):
    start: datetime
    end: datetime
    seconds: int
    surfaces: dict[Surface, int]
    documents: list[str] = Field(description="Slugs, most time first.")


class BookState(StrEnum):
    UNREAD = "unread"
    READING = "reading"
    STALLED = "stalled"  # started, untouched for a while
    FINISHED = "finished"


class Depth(StrEnum):
    """How deep you went with a book; each level implies the ones before it in `DEPTHS`."""

    OPENED = "opened"
    READ = "read"  # a quarter of it
    ANNOTATED = "annotated"
    RECALLED = "recalled"
    REVIEWED = "reviewed"


class BookRow(BaseModel):
    id: str
    slug: str
    title: str
    authors: list[str]
    pages: int | None
    words: int
    chapters: int
    chapters_finished: int
    progress: float = Field(description="Of the book's words, 0 to 1.")
    state: BookState
    seconds: dict[Surface, int] = Field(default_factory=dict)
    total_seconds: int = 0
    words_per_minute: float | None = None
    notes: int = 0
    highlights: int = 0
    notes_per_1k_words: float | None = Field(
        default=None, description="Notes and highlights per 1k words read."
    )
    recalls: int = 0
    reviews: int = 0
    retention: float | None = None
    depth: list[Depth] = Field(default_factory=list, description="The levels reached.")
    first_seen: datetime | None = None
    last_seen: datetime | None = None


class ChapterRow(BaseModel):
    document: str = Field(description="The book's slug.")
    book_title: str
    anchor: str
    title: str
    position: int = Field(description="Reading order within the book.")
    words: int
    pages: int | None
    progress: float
    read_seconds: int = 0
    listen_seconds: int = 0
    other_seconds: int = Field(default=0, description="Study, recall and review of the chapter.")
    visits: int = Field(default=0, description="Distinct days with time in the chapter.")
    notes: int = 0
    highlights: int = 0
    recall_score: float | None = Field(
        default=None, description="Latest graded recall: recalled + half the partials, 0 to 1."
    )
    words_per_minute: float | None = None
    pace: float | None = Field(
        default=None, description="Your usual words per minute over this chapter's (>1: slower)."
    )
    last_seen: datetime | None = None


class PassageRow(BaseModel):
    document: str
    book_title: str
    unit: str
    chapter: str
    anchor: str
    text: str = Field(description="The block's opening words.")
    seconds: int
    visits: int = Field(description="Distinct days you were on it.")
    notes: int = 0


class Count(BaseModel):
    key: str
    count: int


class NoteStats(BaseModel):
    notes: int = 0
    highlights: int = 0
    words: int = 0
    mean_words: float | None = None
    by_color: list[Count] = Field(default_factory=list)
    by_target: list[Count] = Field(default_factory=list)
    length: list[HistogramBin] = Field(default_factory=list, description="Words per note.")
    chapters_without_notes: int = Field(
        default=0, description="Finished chapters with no note or highlight."
    )


class RecallPoint(BaseModel):
    at: datetime
    document: str
    unit: str
    chapter: str
    score: float
    recalled: int
    partial: int
    missed: int


class DuePoint(BaseModel):
    date: date
    count: int


class MemoryStats(BaseModel):
    recalls: int = 0
    predictions: int = 0
    graded: int = 0
    ideas: list[Count] = Field(default_factory=list, description="recalled · partial · missed")
    trend: list[RecallPoint] = Field(default_factory=list)
    reviews: int = 0
    ratings: list[Count] = Field(default_factory=list, description="again · hard · good · easy")
    retention: float | None = None
    cards: int = 0
    card_states: list[Count] = Field(default_factory=list, description="learning · review · …")
    due_now: int = 0
    due: list[DuePoint] = Field(default_factory=list, description="Cards due, next 14 days.")
    mean_stability_days: float | None = None
    by_source: list[Count] = Field(default_factory=list, description="recall · question · card")


class ConceptRow(BaseModel):
    id: str
    name: str
    kind: str
    seconds: int = Field(description="Time in passages that mention it.")
    notes: int = Field(description="Notes on passages that mention it.")
    books: int


class Tone(StrEnum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    ATTENTION = "attention"


class InsightTopic(StrEnum):
    HABIT = "habit"
    PROGRESS = "progress"
    FOCUS = "focus"
    NOTES = "notes"
    MEMORY = "memory"


class ReaderInsight(BaseModel):
    tone: Tone
    topic: InsightTopic
    title: str
    detail: str
    href: str | None = Field(default=None, description="Where to act on it, an app path.")
    metric: str
    value: float


class DepthCount(BaseModel):
    depth: Depth
    books: int


class ReaderStats(BaseModel):
    """What every view shares; the library adds `books`, a book adds `book`."""

    generated_at: datetime
    tz: str
    days: int | None = Field(description="The window, None for all history.")
    tracked_since: datetime | None = Field(description="First tracked minute, if any.")
    totals: Totals
    surfaces: list[SurfaceTime]
    daily: list[DayPoint] = Field(description="Every day of the window with anything in it.")
    hours: list[HourCell] = Field(description="Tracked seconds by weekday and hour.")
    session_lengths: list[HistogramBin]
    sessions: list[Session] = Field(description="The most recent sessions, newest first.")
    chapters: list[ChapterRow] = Field(description="Chapters with time, progress or notes.")
    passages: list[PassageRow] = Field(description="Most visited passages.")
    annotated: list[PassageRow] = Field(description="Most annotated passages.")
    notes: NoteStats
    memory: MemoryStats
    concepts: list[ConceptRow]
    insights: list[ReaderInsight]


class LibraryReaderStats(ReaderStats):
    books: list[BookRow]
    depth: list[DepthCount] = Field(description="Books reaching each depth: a funnel.")


class BookReaderStats(ReaderStats):
    book: BookRow
