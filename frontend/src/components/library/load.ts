/**
 * Server-side loading for the library (page frontmatter only: uses `serverApi`): the
 * whole shelf, the files waiting in `library/`, and per book its reading positions and
 * the book-wide study material. Per-book requests are best effort: a failure leaves
 * that book unread or without materials rather than failing the page.
 */
import { problemOf, type ProblemInfo } from '../common/Problem';
import { fetchAll } from '../../lib/api/fetch-all';
import { serverApi } from '../../lib/api/server';
import type { Page } from '../../lib/api/types';
import type { ArtifactListItem } from '../../lib/api/types/artifacts';
import type { CollectionPublic } from '../../lib/api/types/collections';
import type { DocumentSummary, LibraryFile, ReadingPosition } from '../../lib/api/types/documents';
import { listCollections } from '../../lib/collections/api';
import { availableMaterials, MATERIALS, type AvailableMaterial } from '../../lib/documents/study';
import { mapLimit, NOT_READ, shelfReading, type ShelfReading } from './progress';

/** Past this many books the list shows a count instead of fetching each book's material. */
export const MATERIALS_BOOK_LIMIT = 24;
const PARALLEL = 6;

export interface BookExtras {
  reading: ShelfReading;
  /** Null when not fetched (a big shelf) or the request failed. */
  materials: AvailableMaterial[] | null;
}

export interface LibraryData {
  documents: DocumentSummary[];
  problem: ProblemInfo | null;
  files: LibraryFile[] | null;
  filesProblem: ProblemInfo | null;
  extras: Record<string, BookExtras>;
  /** Every collection, by name; empty when they could not be loaded. */
  collections: CollectionPublic[];
}

/** Each document's collections (slugs, by collection name), keyed by document id. */
export function membershipsOf(collections: readonly CollectionPublic[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of collections) for (const id of c.document_ids) (out[id] ??= []).push(c.slug);
  return out;
}

/** Best effort: a failure reads as not started. */
export async function readingOf(doc: DocumentSummary): Promise<ShelfReading> {
  try {
    const positions = await serverApi().get<ReadingPosition[]>(`documents/${encodeURIComponent(doc.slug)}/reading`);
    return shelfReading(positions, doc.counts.chapters);
  } catch {
    return NOT_READ;
  }
}

/** One small request per material type: the unfiltered list carries every chapter's bodies. */
async function materialsOf(doc: DocumentSummary): Promise<AvailableMaterial[] | null> {
  const live = doc.artifacts.approved + doc.artifacts.draft + doc.artifacts.needs_review;
  if (live === 0) return [];
  try {
    const pages = await Promise.all(
      MATERIALS.map((m) =>
        serverApi().get<Page<ArtifactListItem>>('artifacts', {
          query: { document_id: doc.id, type: m.type, latest: 'true', limit: 100 },
        }),
      ),
    );
    return availableMaterials(doc.slug, pages.flatMap((p) => p.items));
  } catch {
    return null;
  }
}

export async function loadLibrary(): Promise<LibraryData> {
  const api = serverApi();
  const [shelf, pending, collections] = await Promise.allSettled([
    fetchAll<DocumentSummary>(api, 'documents'),
    api.get<Page<LibraryFile>>('library', { query: { limit: 100 } }),
    listCollections(api),
  ]);
  const documents = shelf.status === 'fulfilled' ? shelf.value.items : [];
  const withMaterials = documents.length <= MATERIALS_BOOK_LIMIT;
  const extras = await mapLimit(documents, PARALLEL, async (doc) => {
    const [reading, materials] = await Promise.all([readingOf(doc), withMaterials ? materialsOf(doc) : null]);
    return [doc.slug, { reading, materials }] as const;
  });
  return {
    documents,
    problem: shelf.status === 'rejected' ? problemOf(shelf.reason) : null,
    files: pending.status === 'fulfilled' ? pending.value.items : null,
    filesProblem: pending.status === 'rejected' ? problemOf(pending.reason) : null,
    extras: Object.fromEntries(extras),
    collections: collections.status === 'fulfilled' ? collections.value : [],
  };
}
