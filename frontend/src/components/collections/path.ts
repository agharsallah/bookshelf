/**
 * A collection read as a path: its members in reading order, where you are in it, what
 * comes before and after a document, and which member to pick up next. Pure, so the
 * collection page, the library and the reader share it.
 */
import { GENRE_LABELS, type Genre } from '../../lib/api/types/documents';
import type { ShelfReading } from '../library/progress';

/** The query param that carries a collection through the reader (`?collection=<slug>`). */
export const COLLECTION_PARAM = 'collection';

export interface PathMember {
  id: string;
  slug: string;
  title: string;
  genre: Genre;
}

export interface PathPlace<T> {
  /** 0-based place of the document in the path. */
  index: number;
  total: number;
  prev: T | null;
  next: T | null;
}

/** Where a document sits in the path; null when it is not a member. */
export function placeIn<T extends { id: string }>(members: readonly T[], documentId: string): PathPlace<T> | null {
  const index = members.findIndex((m) => m.id === documentId);
  if (index < 0) return null;
  return { index, total: members.length, prev: members[index - 1] ?? null, next: members[index + 1] ?? null };
}

/** The first member not finished yet, else null (everything read, or an empty path). */
export function upNext<T extends { slug: string }>(members: readonly T[], readings: Readonly<Record<string, ShelfReading>>): T | null {
  return members.find((m) => (readings[m.slug]?.share ?? 0) < 1) ?? null;
}

/** "2 books, 3 papers and an article", for a collection's summary line. */
export function genreSummary(members: readonly Pick<PathMember, 'genre'>[]): string {
  if (members.length === 0) return 'Nothing in it yet';
  const counts = new Map<Genre, number>();
  for (const m of members) counts.set(m.genre, (counts.get(m.genre) ?? 0) + 1);
  const parts = (Object.keys(GENRE_LABELS) as Genre[])
    .filter((g) => counts.has(g))
    .map((g) => {
      const n = counts.get(g) ?? 0;
      const word = GENRE_LABELS[g].toLowerCase();
      return n === 1 ? `${word === 'article' ? 'an' : 'a'} ${word}` : `${n} ${word}s`;
    });
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
}

/** The ids with the one at `index` moved by `delta` places (clamped); a no-op returns a copy. */
export function moved<T>(items: readonly T[], index: number, delta: number): T[] {
  const out = [...items];
  const to = Math.min(Math.max(index + delta, 0), out.length - 1);
  if (index < 0 || index >= out.length || to === index) return out;
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item as T);
  return out;
}

/** The reader for a member, keeping the collection in the URL so the reader offers the next one. */
export function readHref(slug: string, collection: string, anchor?: string | null): string {
  const path = `/documents/${encodeURIComponent(slug)}/read${anchor ? `/${anchor}` : ''}`;
  return `${path}?${COLLECTION_PARAM}=${encodeURIComponent(collection)}`;
}

/** Read a collection slug from a URL's params, the way the reader and the map take it. */
export function collectionParam(params: URLSearchParams): string | null {
  const value = params.get(COLLECTION_PARAM)?.trim() ?? '';
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 80 ? value : null;
}
