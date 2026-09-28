/**
 * The custom properties a book carries inline, read by the library's stylesheet
 * (`library.css`): its dye in every dimension (`--c-kind`...) and how much darker its
 * own cloth is (`--shade`), so switching the dimension only swaps a class; its group
 * in every dimension (`--g-kind`...) for the grouped shelf's first paint; its place in
 * the order (`--i`) for the staggered animations; and its view-transition name, so it
 * glides to its new place when the shelf is re-sorted, filtered or grouped.
 */
import { bucketIndex, DIMENSIONS, dyeOf, type Buckets, type Dimension, type Palette } from './facets';

/** A book's dye (hex) and group index in every dimension of its shelf's palette. */
export interface BookColours {
  dyes: Record<Dimension, string>;
  groups: Record<Dimension, number>;
}

export function bookColours(palette: Palette, buckets: Buckets): BookColours {
  const each = <T>(pick: (d: Dimension) => T) => Object.fromEntries(DIMENSIONS.map((d) => [d, pick(d)])) as Record<Dimension, T>;
  return {
    dyes: each((d) => dyeOf(palette, d, buckets[d])),
    groups: each((d) => bucketIndex(palette, d, buckets[d])),
  };
}

export function dyeStyle(colours: Pick<BookColours, 'dyes'>, shade: number): string {
  return [...DIMENSIONS.map((d) => `--c-${d}:${colours.dyes[d]}`), `--shade:${shade}%`].join(';');
}

/** A CSS identifier from a document id (uuids may start with a digit). */
export const transitionName = (id: string): string => `book-${id.replace(/[^\w-]/g, '')}`;

export function placeStyle(id: string, colours: Pick<BookColours, 'groups'>, index: number): string {
  return [
    `--i:${index}`,
    ...DIMENSIONS.map((d) => `--g-${d}:${colours.groups[d]}`),
    `view-transition-name:${transitionName(id)}`,
  ].join(';');
}
