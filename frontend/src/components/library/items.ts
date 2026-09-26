/**
 * The books as the shelf and the list render them: in the chosen order, each with its
 * reading, its study material, whether it is the current book, and whether the
 * filters hide it. Every book is rendered (hidden ones too), so the browser can filter
 * and re-order as the reader types without another round trip.
 */
import type { DocumentSummary } from '../../lib/api/types/documents';
import type { AvailableMaterial } from '../../lib/documents/study';
import { matchesFilters, type LibraryFilters } from './filters';
import { currentBook, NOT_READ, type ShelfReading } from './progress';
import { sortBy, sortKeys, type Sort } from './sort';

export interface LibraryItem {
  doc: DocumentSummary;
  reading: ShelfReading;
  materials: AvailableMaterial[] | null;
  current: boolean;
  hidden: boolean;
}

export function libraryItems(
  documents: readonly DocumentSummary[],
  extras: Readonly<Record<string, { reading: ShelfReading; materials: AvailableMaterial[] | null }>>,
  filters: LibraryFilters,
  sort: Sort,
): LibraryItem[] {
  const readingOf = (doc: DocumentSummary) => extras[doc.slug]?.reading ?? NOT_READ;
  const current = currentBook(Object.fromEntries(documents.map((d) => [d.slug, readingOf(d)])));
  return sortBy(documents, (doc) => sortKeys(doc, readingOf(doc).lastRead), sort).map((doc) => ({
    doc,
    reading: readingOf(doc),
    materials: extras[doc.slug]?.materials ?? null,
    current: doc.slug === current,
    hidden: !matchesFilters(doc, filters),
  }));
}
