/**
 * Which layout the reader is in, from the panes that are actually on screen (the
 * contents rail only fits on wide screens), and the geometry of dragging the text
 * column's width when exactly one side pane is shown.
 *
 * - `both`:  rail | text | pane, the text at the chosen width preset.
 * - `one`:   one side pane put away; the text width can be dragged.
 * - `fill`:  both put away; the text takes the whole page width.
 * - `focus`: focus mode; the text centred at the chosen preset.
 * - `stack`: phones; one pane at a time.
 */

export type ReaderLayout = 'both' | 'one' | 'fill' | 'focus' | 'stack';

export interface LayoutInput {
  rail: boolean;
  pane: boolean;
  focus: boolean;
  /** The rail fits beside the text (Reader.module.css, 90rem). */
  wide: boolean;
  /** One pane at a time (Reader.module.css, 56rem). */
  narrow: boolean;
}

export function readerLayout({ rail, pane, focus, wide, narrow }: LayoutInput): ReaderLayout {
  if (narrow) return 'stack';
  if (focus) return 'focus';
  const shown = (rail && wide ? 1 : 0) + (pane ? 1 : 0);
  return shown === 2 ? 'both' : shown === 1 ? 'one' : 'fill';
}

/** The narrowest a dragged text column may get, gutters included (px). */
export const MIN_MEASURE = 384;

export function clampMeasure(px: number): number {
  return Math.max(MIN_MEASURE, Math.round(px));
}

/**
 * The text width that puts the column's edge under the pointer. With the pane
 * shown the column is anchored at its start (`origin` = its left edge); without it
 * the column is centred (`origin` = its centre), so its edge moves half as fast as
 * its width. The grid still caps the width at the room available.
 */
export function dragMeasure(pointerX: number, origin: number, centred: boolean): number {
  return clampMeasure(centred ? 2 * (pointerX - origin) : pointerX - origin);
}
