/**
 * Reader statistics (`GET /reader-stats`, `GET /documents/{ref}/reader-stats`), mirroring
 * `backend/app/schemas/reader_stats.py`. Time is seconds of attention since `tracked_since`;
 * progress, notes, recalls and reviews cover all history. Days and hours are in `tz`.
 */
import type { Surface } from '../../activity/log';

export type { Surface };

export interface SurfaceTime {
  surface: Surface;
  seconds: number;
  share: number;
}

export interface Totals {
  seconds: number;
  reading_seconds: number;
  listening_seconds: number;
  study_seconds: number;
  active_days: number;
  sessions: number;
  mean_session_seconds: number | null;
  median_session_seconds: number | null;
  longest_session_seconds: number | null;
  current_streak: number;
  longest_streak: number;
  books_started: number;
  books_finished: number;
  chapters_finished: number;
  words_read: number;
  pages_read: number;
  words_per_minute: number | null;
  notes: number;
  highlights: number;
  words_written: number;
  recalls: number;
  predictions: number;
  reviews: number;
  retention: number | null;
}

export type SurfaceSeconds = Partial<Record<Surface, number>>;

export interface DayPoint {
  /** `YYYY-MM-DD`, local to `tz`. */
  date: string;
  seconds: SurfaceSeconds;
  notes: number;
  reviews: number;
  recalls: number;
  /** Chapters whose reading place last moved that day. */
  moves: number;
}

export interface HourCell {
  /** Monday is 0. */
  weekday: number;
  hour: number;
  seconds: number;
}

export interface HistogramBin {
  label: string;
  low: number;
  high: number | null;
  count: number;
}

export interface Session {
  start: string;
  end: string;
  seconds: number;
  surfaces: SurfaceSeconds;
  documents: string[];
}

export type BookState = 'unread' | 'reading' | 'stalled' | 'finished';
export type Depth = 'opened' | 'read' | 'annotated' | 'recalled' | 'reviewed';

export interface BookRow {
  id: string;
  slug: string;
  title: string;
  authors: string[];
  pages: number | null;
  words: number;
  chapters: number;
  chapters_finished: number;
  progress: number;
  state: BookState;
  seconds: SurfaceSeconds;
  total_seconds: number;
  words_per_minute: number | null;
  notes: number;
  highlights: number;
  notes_per_1k_words: number | null;
  recalls: number;
  reviews: number;
  retention: number | null;
  depth: Depth[];
  first_seen: string | null;
  last_seen: string | null;
}

export interface ChapterRow {
  document: string;
  book_title: string;
  anchor: string;
  title: string;
  position: number;
  words: number;
  pages: number | null;
  progress: number;
  read_seconds: number;
  listen_seconds: number;
  other_seconds: number;
  visits: number;
  notes: number;
  highlights: number;
  recall_score: number | null;
  words_per_minute: number | null;
  /** Your usual words per minute over this chapter's: above 1 is slower than usual. */
  pace: number | null;
  last_seen: string | null;
}

export interface PassageRow {
  document: string;
  book_title: string;
  unit: string;
  chapter: string;
  anchor: string;
  text: string;
  seconds: number;
  visits: number;
  notes: number;
}

export interface Count {
  key: string;
  count: number;
}

export interface NoteStats {
  notes: number;
  highlights: number;
  words: number;
  mean_words: number | null;
  by_color: Count[];
  by_target: Count[];
  length: HistogramBin[];
  chapters_without_notes: number;
}

export interface RecallPoint {
  at: string;
  document: string;
  unit: string;
  chapter: string;
  score: number;
  recalled: number;
  partial: number;
  missed: number;
}

export interface DuePoint {
  date: string;
  count: number;
}

export interface MemoryStats {
  recalls: number;
  predictions: number;
  graded: number;
  ideas: Count[];
  trend: RecallPoint[];
  reviews: number;
  ratings: Count[];
  retention: number | null;
  cards: number;
  card_states: Count[];
  due_now: number;
  due: DuePoint[];
  mean_stability_days: number | null;
  by_source: Count[];
}

export interface ConceptRow {
  id: string;
  name: string;
  kind: string;
  seconds: number;
  notes: number;
  books: number;
}

export type Tone = 'positive' | 'neutral' | 'attention';
export type InsightTopic = 'habit' | 'progress' | 'focus' | 'notes' | 'memory';

export interface ReaderInsight {
  tone: Tone;
  topic: InsightTopic;
  title: string;
  detail: string;
  href: string | null;
  metric: string;
  value: number;
}

export interface ReaderStats {
  generated_at: string;
  tz: string;
  days: number | null;
  tracked_since: string | null;
  totals: Totals;
  surfaces: SurfaceTime[];
  daily: DayPoint[];
  hours: HourCell[];
  session_lengths: HistogramBin[];
  sessions: Session[];
  chapters: ChapterRow[];
  passages: PassageRow[];
  annotated: PassageRow[];
  notes: NoteStats;
  memory: MemoryStats;
  concepts: ConceptRow[];
  insights: ReaderInsight[];
}

export interface LibraryReaderStats extends ReaderStats {
  books: BookRow[];
  depth: { depth: Depth; books: number }[];
}

export interface BookReaderStats extends ReaderStats {
  book: BookRow;
}
