/**
 * Reading progress as the library shows it, from a book's reading positions alone
 * (`GET /documents/{slug}/reading`): no chapter tree per book, so each chapter counts
 * the same. The document page has the page-weighted figure; this is the glance.
 */
import type { ReadingPosition } from '../../lib/api/types/documents';
import { isFinished } from '../../lib/documents/reading';

export interface ShelfReading {
  /** 0–1 of the book's chapters, a finished chapter counting whole. */
  share: number;
  /** When the book was last read (ISO), or null when never opened. */
  lastRead: string | null;
  /** The block to pick up at: the latest position, unless its chapter is finished. */
  resume: string | null;
}

export const NOT_READ: ShelfReading = { share: 0, lastRead: null, resume: null };

export function shelfReading(positions: readonly ReadingPosition[], chapters: number): ShelfReading {
  if (positions.length === 0) return NOT_READ;
  const read = positions.reduce((sum, p) => sum + (isFinished(p.progress) ? 1 : Math.max(0, p.progress)), 0);
  const latest = positions.reduce((last, p) => (p.updated_at > last.updated_at ? p : last));
  return {
    share: Math.min(1, read / Math.max(chapters, positions.length, 1)),
    lastRead: latest.updated_at || null,
    resume: isFinished(latest.progress) ? null : latest.anchor,
  };
}

/**
 * The reading with the document's finished mark folded in: read through, whatever the
 * positions say (a short chapter's last lines that never crossed the reading line, front
 * matter nobody reads). Unmarked, the reading is unchanged.
 */
export function withFinished(reading: ShelfReading, finishedAt: string | null): ShelfReading {
  if (!finishedAt) return reading;
  return { share: 1, lastRead: reading.lastRead ?? finishedAt, resume: null };
}

/** The book read most recently: the one that wears the bookmark ribbon. */
export function currentBook(readings: Readonly<Record<string, ShelfReading>>): string | null {
  let best: string | null = null;
  let latest = '';
  for (const [slug, reading] of Object.entries(readings)) {
    if (reading.lastRead && reading.lastRead > latest) {
      latest = reading.lastRead;
      best = slug;
    }
  }
  return best;
}

/** "12% read", "Finished", or "Not started", for labels and screen readers. */
export function readingLabel(reading: ShelfReading): string {
  if (!reading.lastRead) return 'Not started';
  if (reading.share >= 1) return 'Finished';
  return `${Math.max(1, Math.round(reading.share * 100))}% read`;
}

/**
 * `work` over every item with at most `limit` running at once, results in input order.
 * Keeps a big shelf from opening hundreds of backend requests on one page load.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
