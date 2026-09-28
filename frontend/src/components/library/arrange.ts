/**
 * The order the shelf and the list stand in: the books sorted, and when grouped, each
 * group's divider card first and its books after it, groups in their dividers' order
 * (the shelf's palette, `facets.ts`). Books in no divider's group come after them;
 * dividers of the other dimensions go last (they are hidden). Used in
 * the browser to move the rendered elements, so the reading and tab order match what
 * is seen; the server's first paint gets the same order from CSS `order`.
 */
import type { Dimension } from './facets';
import { sortBy, type Sort, type SortKeys } from './sort';

export interface Divider {
  dimension: string;
  bucket: string;
  /** The bucket's place in its dimension. */
  index: number;
}

export function arrange<B, D extends Divider>(
  books: readonly B[],
  dividers: readonly D[],
  keysOf: (book: B) => SortKeys,
  bucketOf: (book: B, dimension: Dimension) => string,
  sort: Sort,
  group: Dimension | null,
): (B | D)[] {
  const sorted = sortBy(books, keysOf, sort);
  if (group === null) return [...sorted, ...dividers];
  const own = dividers.filter((d) => d.dimension === group).sort((a, b) => a.index - b.index);
  const known = own.map((d) => d.bucket);
  const ordered: (B | D)[] = [];
  for (const divider of own) {
    ordered.push(divider, ...sorted.filter((book) => bucketOf(book, group) === divider.bucket));
  }
  ordered.push(...sorted.filter((book) => !known.includes(bucketOf(book, group))));
  ordered.push(...dividers.filter((d) => d.dimension !== group));
  return ordered;
}
