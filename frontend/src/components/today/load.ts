/**
 * Server-side loading for Today (server islands only: uses `serverApi`). Every book's
 * reading positions (one call), then outlines for the few books read most recently; a call that
 * fails leaves that book unread instead of failing the page. Due cards, today's passage
 * and the week each load alone, or come back null.
 */
import { fetchAll } from '../../lib/api/fetch-all';
import { serverApi } from '../../lib/api/server';
import type { Page } from '../../lib/api/types';
import type { DocumentSummary, ReadingPosition } from '../../lib/api/types/documents';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { LibraryReaderStats } from '../../lib/api/types/readerStats';
import type { DueCards } from '../../lib/api/types/recalls';
import { getOutline, getShelfReading } from '../../lib/documents/server';
import { readingUnits } from '../../lib/documents/tree';
import { dayOffset, isReadable, marginNotes, NOTE_WINDOW, todayBook, type BookIndex, type MarginNote, type TodayBook } from './today';

/** Books whose outlines load: the ones read most recently, enough for Pick up and "Also open". */
export const OUTLINE_CAP = 4;

const lastMoved = (positions: readonly ReadingPosition[]) => positions.reduce((latest, p) => (p.updated_at > latest ? p.updated_at : latest), '');

/**
 * Every book, with outlines for the few that matter today. Reading positions are one
 * call for the whole shelf, so the book you are in is found however many papers
 * arrived since; outlines load only for the books read most recently or, when none
 * was read, the newest one to start.
 */
export async function loadBooks(): Promise<TodayBook[]> {
  const [{ items }, reading] = await Promise.all([fetchAll<DocumentSummary>(serverApi(), 'documents', {}, 5), getShelfReading()]);
  const readable = items.filter(isReadable);
  const read = readable
    .map((doc) => ({ doc, positions: reading[doc.id] ?? [] }))
    .filter((b) => b.positions.length > 0)
    .sort((a, b) => lastMoved(b.positions).localeCompare(lastMoved(a.positions)))
    .slice(0, OUTLINE_CAP);
  const newest = [...readable].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const chosen = read.length > 0 ? read : newest ? [{ doc: newest, positions: [] }] : [];
  const detailed = await Promise.all(
    chosen.map(async ({ doc, positions }) => {
      const tree = await getOutline(doc.slug).catch(() => null);
      return todayBook(doc, tree ? readingUnits(tree.nodes) : [], positions);
    }),
  );
  const ids = new Set(chosen.map((c) => c.doc.id));
  return [...detailed, ...items.filter((doc) => !ids.has(doc.id)).map((doc) => todayBook(doc, [], []))];
}

/** Review cards due across every book; null when they could not be loaded. */
export async function loadDue(): Promise<DueCards | null> {
  return await serverApi()
    .get<DueCards>('reviews/due')
    .catch(() => null);
}

export interface Margins {
  note: MarginNote | null;
  /** Every note you made, so the page knows whether there is another to show. */
  total: number;
}

/** Today's passage from your notes: the same one all day, a different one tomorrow. */
export async function loadMargin(books: BookIndex, today: string): Promise<Margins | null> {
  const api = serverApi();
  const page = (offset: number) => api.get<Page<NoteDetail>>('notes', { query: { limit: NOTE_WINDOW, offset } });
  try {
    const { total } = await api.get<Page<NoteDetail>>('notes', { query: { limit: 1 } });
    if (total === 0) return { note: null, total };
    const offset = dayOffset(today, total);
    const first = marginNotes((await page(offset)).items, books)[0];
    // Near the end of the list the window can come up empty: start over from the oldest.
    const note = first ?? (offset > 0 ? marginNotes((await page(0)).items, books)[0] : undefined) ?? null;
    return { note, total };
  } catch {
    return null;
  }
}

/** The last seven days of reader statistics in the server's zone; null when they could not be loaded. */
export async function loadWeek(tz: string): Promise<LibraryReaderStats | null> {
  return await serverApi()
    .get<LibraryReaderStats>('reader-stats', { query: { tz, days: 7 } })
    .catch(() => null);
}
