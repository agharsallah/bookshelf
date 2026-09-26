/**
 * Which layout the reader is in, from the panes that are actually on screen (the
 * contents rail only fits on wide screens), and the geometry of dragging the text
 * column's width while a side pane is shown.
 *
 * - `both`:  rail | text | pane; the text width can be dragged.
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

/** Layouts where the text width follows the grip rather than the preset. */
export function canDragMeasure(layout: ReaderLayout): boolean {
  return layout === 'both' || layout === 'one';
}

/** The text column is centred when no pane sits beside it (only the rail, opposite an empty track). */
export function isCentred(layout: ReaderLayout, pane: boolean): boolean {
  return layout === 'one' && !pane;
}

/** The narrowest a dragged text column may get, gutters included (px). */
export const MIN_MEASURE = 384;

export function clampMeasure(px: number): number {
  return Math.max(MIN_MEASURE, Math.round(px));
}

/**
 * Which part of a resizable column stays put while its grip is dragged: its start
 * (the grip on its end edge), its centre (both edges move), or its end (the grip
 * on its start edge, as for a drawer pinned to the right of the screen).
 */
export type MeasureAnchor = 'start' | 'centre' | 'end';

/**
 * The width that puts the column's moving edge under the pointer. `origin` is the
 * anchored point: the column's left edge (`start`), its centre (`centre`, so the
 * edge moves half as fast as the width) or its right edge (`end`, so dragging left
 * widens it). The layout still caps the width at the room available.
 */
export function dragMeasure(pointerX: number, origin: number, anchor: MeasureAnchor): number {
  if (anchor === 'centre') return clampMeasure(2 * (pointerX - origin));
  return clampMeasure(anchor === 'end' ? origin - pointerX : pointerX - origin);
}
