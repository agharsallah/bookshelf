/**
 * Today's model: each book with how far you read it, the one to pick up (the book you
 * are in, else the newest one to start) and the others still open, the line that says
 * what today holds, the week of reading behind it, and the passage from your margins
 * that comes back today. Pure functions.
 */
import type { DocumentSummary, ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { DayPoint } from '../../lib/api/types/readerStats';
import type { HighlightColor } from '../../lib/contract';
import { anchorLabel } from '../../lib/anchors';
import { bookProgress, continueTarget, percent, positionsByUnit, type BookProgress, type ContinueTarget } from '../../lib/documents/reading';
import { defaultUnit } from '../../lib/documents/tree';

/** Until parsing succeeds a document has no chapters to read. */
const UNREADABLE = new Set(['registered', 'parsing', 'parse_failed']);

export const isReadable = (doc: Pick<DocumentSummary, 'status'>): boolean => !UNREADABLE.has(doc.status);

export interface TodayBook {
  doc: DocumentSummary;
  units: TreeNode[];
  positions: Record<string, ReadingPosition>;
  progress: BookProgress;
  resume: ContinueTarget | null;
  /** When you last read in it; null when never opened. */
  lastRead: string | null;
}

export function todayBook(doc: DocumentSummary, units: TreeNode[], reading: readonly ReadingPosition[]): TodayBook {
  const positions = positionsByUnit(reading, units);
  const lastRead = Object.values(positions).reduce<string | null>((latest, p) => (!latest || p.updated_at > latest ? p.updated_at : latest), null);
  return { doc, units, positions, progress: bookProgress(reading, units), resume: continueTarget(reading, units), lastRead };
}

/** Where "Pick up" puts you: in a book, at the start of one, or nowhere yet. */
export type Hero =
  | { kind: 'continue'; book: TodayBook; target: ContinueTarget }
  | { kind: 'finished'; book: TodayBook }
  | { kind: 'start'; book: TodayBook; unit: TreeNode }
  | { kind: 'waiting' }
  | { kind: 'empty' };

const newestFirst = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');

const byLastRead = (books: readonly TodayBook[]) => books.filter((b) => b.lastRead).sort((a, b) => newestFirst(a.lastRead, b.lastRead));

/** The book read most recently; failing that, the newest readable book to start. */
export function pickHero(books: readonly TodayBook[]): Hero {
  if (books.length === 0) return { kind: 'empty' };
  const read = byLastRead(books)[0];
  if (read) return read.resume ? { kind: 'continue', book: read, target: read.resume } : { kind: 'finished', book: read };
  const fresh = books
    .filter((b) => isReadable(b.doc) && b.units.length > 0)
    .sort((a, b) => newestFirst(a.doc.created_at, b.doc.created_at))[0];
  const unit = fresh ? defaultUnit(fresh.units) : undefined;
  return fresh && unit ? { kind: 'start', book: fresh, unit } : { kind: 'waiting' };
}

/** The other books you are part way through, most recently read first. */
export function alsoReading(books: readonly TodayBook[], hero: Hero, limit = 3): (TodayBook & { resume: ContinueTarget })[] {
  const skip = 'book' in hero ? hero.book.doc.id : null;
  return byLastRead(books)
    .filter((b): b is TodayBook & { resume: ContinueTarget } => b.doc.id !== skip && b.resume !== null && b.progress.progress > 0)
    .slice(0, limit);
}

/** "Chapter 3 · How Behavioral Interviews Work" (front matter and articles by heading). */
export function unitName(unit: Pick<TreeNode, 'anchor' | 'heading' | 'kind' | 'meta'>): string {
  const heading = unit.heading ?? unit.anchor;
  if (unit.meta.front_matter) return heading;
  const noun = unit.kind === 'chapter' ? 'Chapter' : 'Section';
  return `${noun} ${anchorLabel(unit.anchor)} · ${heading}`;
}

/** "40% of the book" / "40% read"; under one percent reads as just started. */
export function readShare(progress: number, suffix = 'of the book'): string {
  const value = percent(progress);
  return value === 0 && progress > 0 ? 'Just started' : `${value}% ${suffix}`;
}

/** A title before its subtitle: "Deep Work" of "Deep Work: Rules for Focused Success". */
export function shortTitle(title: string): string {
  const head = title.split(/:\s/)[0]?.trim();
  return head || title;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** "back to chapter 4 of Deep Work", "on to chapter 5 of…", "start Deep Work"; null with no book to read. */
function readingStep(hero: Hero, title: string): string | null {
  if (hero.kind === 'start') return `start ${title}`;
  if (hero.kind !== 'continue') return null;
  const { unit, kind } = hero.target;
  if (unit.meta.front_matter) return `back into ${title}`;
  const where = `${unit.kind === 'chapter' ? 'chapter' : 'section'} ${anchorLabel(unit.anchor)}`;
  return `${kind === 'continue' ? 'back to' : 'on to'} ${where} of ${title}`;
}

/** What today holds, in one line: the cards due first, then where the reading is. */
export function dayPlan(hero: Hero, due: number | null): string {
  const title = 'book' in hero ? shortTitle(hero.book.doc.title) : '';
  const reading = readingStep(hero, title);
  if (due && due > 0) return reading ? `${plural(due, 'card')} to review, then ${reading}.` : `${plural(due, 'card')} to review.`;
  if (reading) return `Nothing to review today. ${reading.charAt(0).toUpperCase()}${reading.slice(1)}.`;
  if (hero.kind === 'finished') return `Nothing to review today, and you have read all of ${title}.`;
  if (hero.kind === 'waiting') return 'Your books are still being prepared. They open here once their chapters are split.';
  return 'Add a book to the library and it opens here, ready to read.';
}

export interface WeekDay {
  /** `YYYY-MM-DD`, local to the reader's zone. */
  date: string;
  /** "M", "T", "W"… */
  initial: string;
  /** "Tuesday 29 September" */
  name: string;
  seconds: number;
  /** 0–1 of the busiest day this week. */
  height: number;
  today: boolean;
}

/** Calendar date `days` before `date`, both `YYYY-MM-DD`, counted at noon UTC so no zone shifts it. */
function dateBefore(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
}

/** The seven days ending today, each with its time, scaled to the busiest one. */
export function weekDays(daily: readonly DayPoint[], today: string): WeekDay[] {
  const byDate = new Map(daily.map((d) => [d.date, Object.values(d.seconds).reduce((sum, s) => sum + (s ?? 0), 0)]));
  const dates = Array.from({ length: 7 }, (_, i) => dateBefore(today, 6 - i));
  const most = Math.max(1, ...dates.map((d) => byDate.get(d) ?? 0));
  return dates.map((date) => {
    const at = new Date(`${date}T12:00:00Z`);
    const seconds = byDate.get(date) ?? 0;
    return {
      date,
      initial: at.toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' }),
      name: at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
      seconds,
      height: seconds / most,
      today: date === today,
    };
  });
}

/** A marked passage brought back from your margins. */
export interface MarginNote {
  id: string;
  passage: string;
  /** Your words on it; null for a plain highlight. */
  raw: string | null;
  color: HighlightColor | null;
  anchor: string;
  created_at: string;
  book: { slug: string; title: string };
}

/** Notes read at a time, so a detached one or two still leave a passage to show. */
export const NOTE_WINDOW = 10;

export type BookIndex = Readonly<Record<string, { slug: string; title: string }>>;

/** Long passages stop at a word near `max` characters. */
export function trimPassage(text: string, max = 420): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.8)).replace(/[\s,;:.]+$/, '')}…`;
}

/** The notes worth bringing back: they still mark words, in a book on the shelf; `skip` left out. */
export function marginNotes(notes: readonly NoteDetail[], books: BookIndex, skip?: string): MarginNote[] {
  return notes.flatMap((n) => {
    const book = books[n.document_id];
    const passage = n.passage?.trim();
    if (n.detached || !passage || !book || n.id === skip) return [];
    return [{ id: n.id, passage: trimPassage(passage), raw: n.raw?.trim() || null, color: n.color, anchor: n.anchor, created_at: n.created_at, book }];
  });
}

/** Where in your notes today's passage sits: the same all day, a different one tomorrow. */
export function dayOffset(today: string, total: number): number {
  if (total <= 0) return 0;
  let hash = 0;
  for (const ch of today) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % total;
}

/** "Marked 3 days ago", "Marked yesterday", "Marked on 24 September 2025". */
export function markedWhen(at: string, now: string): string {
  const days = Math.floor((Date.parse(now) - Date.parse(at)) / 86_400_000);
  if (days <= 0) return 'Marked today';
  if (days === 1) return 'Marked yesterday';
  if (days < 30) return `Marked ${days} days ago`;
  const date = new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Marked on ${date}`;
}

/** Today as `YYYY-MM-DD` in the server's zone (the reader's own machine). */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
