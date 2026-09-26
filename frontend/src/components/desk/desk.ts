/**
 * The Desk's model: each book with how far you read it and what it became, the one to
 * put in front of you (the book you are in, else the newest one to start), the study
 * material grouped by book, and the numbers for the pages-read chart. Pure functions.
 */
import type { DocumentSummary, ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import { anchorLabel } from '../../lib/anchors';
import { bookProgress, continueTarget, percent, positionsByUnit, type BookProgress, type ContinueTarget } from '../../lib/documents/reading';
import type { AvailableMaterial } from '../../lib/documents/study';
import { defaultUnit } from '../../lib/documents/tree';

/** Until parsing succeeds a document has no chapters to read. */
const UNREADABLE = new Set(['registered', 'parsing', 'parse_failed']);

export const isReadable = (doc: Pick<DocumentSummary, 'status'>): boolean => !UNREADABLE.has(doc.status);

export interface DeskBook {
  doc: DocumentSummary;
  units: TreeNode[];
  positions: Record<string, ReadingPosition>;
  progress: BookProgress;
  resume: ContinueTarget | null;
  /** When you last read in it; null when never opened. */
  lastRead: string | null;
  materials: AvailableMaterial[];
  /** Pages in the book: its page count, else the chapters' spans. */
  pages: number;
}

function unitPages(unit: Pick<TreeNode, 'page_from' | 'page_to'>): number {
  const { page_from: from, page_to: to } = unit;
  return from !== null && to !== null && to >= from ? to - from + 1 : 1;
}

export function deskBook(
  doc: DocumentSummary,
  units: TreeNode[],
  reading: readonly ReadingPosition[],
  materials: AvailableMaterial[] = [],
): DeskBook {
  const positions = positionsByUnit(reading, units);
  const lastRead = Object.values(positions).reduce<string | null>((latest, p) => (!latest || p.updated_at > latest ? p.updated_at : latest), null);
  const counted = units.reduce((sum, u) => sum + unitPages(u), 0);
  return {
    doc,
    units,
    positions,
    progress: bookProgress(reading, units),
    resume: continueTarget(reading, units),
    lastRead,
    materials,
    pages: doc.page_count ?? (units.length ? counted : 0),
  };
}

/** Where the hero puts you: in a book, at the start of one, or at an empty desk. */
export type Hero =
  | { kind: 'continue'; book: DeskBook; target: ContinueTarget }
  | { kind: 'finished'; book: DeskBook }
  | { kind: 'start'; book: DeskBook; unit: TreeNode }
  | { kind: 'waiting' }
  | { kind: 'empty' };

const newestFirst = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');

/** The book read most recently; failing that, the newest readable book to start. */
export function pickHero(books: readonly DeskBook[]): Hero {
  if (books.length === 0) return { kind: 'empty' };
  const read = books.filter((b) => b.lastRead).sort((a, b) => newestFirst(a.lastRead, b.lastRead))[0];
  if (read) return read.resume ? { kind: 'continue', book: read, target: read.resume } : { kind: 'finished', book: read };
  const fresh = books
    .filter((b) => isReadable(b.doc) && b.units.length > 0)
    .sort((a, b) => newestFirst(a.doc.created_at, b.doc.created_at))[0];
  const unit = fresh ? defaultUnit(fresh.units) : undefined;
  return fresh && unit ? { kind: 'start', book: fresh, unit } : { kind: 'waiting' };
}

/** "Chapter 3 · How Behavioral Interviews Work" (front matter and articles by heading). */
export function unitName(unit: Pick<TreeNode, 'anchor' | 'heading' | 'kind' | 'meta'>): string {
  const heading = unit.heading ?? unit.anchor;
  if (unit.meta.front_matter) return heading;
  const noun = unit.kind === 'chapter' ? 'Chapter' : 'Section';
  return `${noun} ${anchorLabel(unit.anchor)} · ${heading}`;
}

/** Where you are in words: the chapter, and how far into it when you have begun. */
export function whereYouAre(target: ContinueTarget): string {
  const name = unitName(target.unit);
  return target.progress > 0 ? `${name}, ${percent(target.progress)}%` : name;
}

/** "40% of the book" / "40% read"; under one percent reads as just started. */
export function readShare(progress: number, suffix = 'of the book'): string {
  const value = percent(progress);
  return value === 0 && progress > 0 ? 'Just started' : `${value}% ${suffix}`;
}

/** Recently read first, then never-opened books newest first, then by title. */
export function shelfOrder(books: readonly DeskBook[]): DeskBook[] {
  return [...books].sort(
    (a, b) =>
      newestFirst(a.lastRead, b.lastRead) ||
      newestFirst(a.doc.created_at, b.doc.created_at) ||
      a.doc.title.localeCompare(b.doc.title),
  );
}

export interface StudyGroup {
  book: DeskBook;
  materials: AvailableMaterial[];
}

/** Study material by book, only books that have some, in shelf order. */
export function studyGroups(books: readonly DeskBook[]): StudyGroup[] {
  return shelfOrder(books)
    .filter((b) => b.materials.length > 0)
    .map((book) => ({ book, materials: book.materials }));
}

/** Material you read (brief, guide, glossary, quotes) apart from what you practise with. */
const PRACTICE = new Set<AvailableMaterial['kind']>(['flashcards', 'quiz', 'faq']);

export function splitMaterials(materials: readonly AvailableMaterial[]): { read: AvailableMaterial[]; practise: AvailableMaterial[] } {
  return {
    read: materials.filter((m) => !PRACTICE.has(m.kind)),
    practise: materials.filter((m) => PRACTICE.has(m.kind)),
  };
}

export interface PagesBar {
  slug: string;
  title: string;
  pages: number;
  read: number;
  /** 0–1 of the longest book, so bars share one scale. */
  width: number;
  /** 0–1 of this book's pages. */
  share: number;
}

export interface PagesChart {
  bars: PagesBar[];
  read: number;
  total: number;
}

/** Pages read against pages on the shelf, one bar per readable book on a common scale. */
export function pagesChart(books: readonly DeskBook[]): PagesChart {
  const counted = shelfOrder(books).filter((b) => b.pages > 0 && b.units.length > 0);
  const longest = Math.max(1, ...counted.map((b) => b.pages));
  const bars = counted.map((b) => {
    const read = Math.round(b.progress.progress * b.pages);
    return { slug: b.doc.slug, title: b.doc.title, pages: b.pages, read, width: b.pages / longest, share: read / b.pages };
  });
  return {
    bars,
    read: bars.reduce((sum, b) => sum + b.read, 0),
    total: bars.reduce((sum, b) => sum + b.pages, 0),
  };
}
