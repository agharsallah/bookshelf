/**
 * The books as the shelf and the list render them: in the chosen order, each with its
 * reading, its study material, its place in each facet, whether it is the current book,
 * and whether the filters hide it. Every book is rendered (hidden ones too), so the
 * browser can filter, re-order and group as the reader types without another round trip.
 */
import type { DocumentSummary } from '../../lib/api/types/documents';
import type { AvailableMaterial } from '../../lib/documents/study';
import { bookColours, type BookColours } from './book-style';
import { bucketsOf, DIMENSIONS, DYES, shelfPalette, type Buckets, type Dimension, type Palette } from './facets';
import { matchesFilters, type LibraryFilters } from './filters';
import { currentBook, NOT_READ, type ShelfReading } from './progress';
import { sortBy, sortKeys, type Sort, type SortKeys } from './sort';

export interface LibraryItem {
  doc: DocumentSummary;
  reading: ShelfReading;
  materials: AvailableMaterial[] | null;
  buckets: Buckets;
  /** Its dye and group in every dimension of the shelf's palette. */
  colours: BookColours;
  keys: SortKeys;
  current: boolean;
  hidden: boolean;
}

export function libraryItems(
  documents: readonly DocumentSummary[],
  extras: Readonly<Record<string, { reading: ShelfReading; materials: AvailableMaterial[] | null }>>,
  filters: LibraryFilters,
  sort: Sort,
  palette: Palette = shelfPalette(documents),
): LibraryItem[] {
  const readingOf = (doc: DocumentSummary) => extras[doc.slug]?.reading ?? NOT_READ;
  const current = currentBook(Object.fromEntries(documents.map((d) => [d.slug, readingOf(d)])));
  const items = documents.map((doc) => {
    const reading = readingOf(doc);
    const buckets = bucketsOf(doc, reading);
    return {
      doc,
      reading,
      materials: extras[doc.slug]?.materials ?? null,
      buckets,
      colours: bookColours(palette, buckets),
      keys: sortKeys(doc, reading),
      current: doc.slug === current,
      hidden: !matchesFilters({ ...doc, genre: buckets.kind, reading: buckets.reading, study: buckets.study, theme: buckets.theme }, filters),
    };
  });
  return sortBy(items, (item) => item.keys, sort);
}

export interface DividerCard {
  dimension: Dimension;
  bucket: string;
  label: string;
  dye: string;
  /** The bucket's place in its dimension. */
  index: number;
  /** Books in the bucket the filters let through. */
  count: number;
}

/** One divider card per bucket of every dimension, for the grouped shelf and list. */
export function dividerCards(palette: Palette, items: readonly Pick<LibraryItem, 'buckets' | 'hidden'>[]): DividerCard[] {
  return DIMENSIONS.flatMap((dimension) =>
    palette[dimension].map((bucket, index) => ({
      dimension,
      bucket: bucket.value,
      label: bucket.label,
      dye: DYES[bucket.dye],
      index,
      count: items.filter((item) => !item.hidden && item.buckets[dimension] === bucket.value).length,
    })),
  );
}
