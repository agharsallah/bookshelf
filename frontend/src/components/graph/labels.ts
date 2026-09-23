/**
 * Label placement with collision avoidance, in screen space. Labels are placed greedily
 * by priority (the focus, the hovered node and its neighbours, then ring and weight);
 * each tries the right, left, below and above of its node and takes the first spot
 * that overlaps no placed label, no other node's mark, and stays in the viewport.
 * A label that fits nowhere is left out; zooming in makes room for it.
 */

export interface LabelCandidate {
  id: string;
  /** Screen position of the node's centre. */
  x: number;
  y: number;
  /** Screen radius of the node's mark. */
  r: number;
  width: number;
  height: number;
  priority: number;
}

export type LabelSide = 'right' | 'left' | 'below' | 'above';

export interface PlacedLabel {
  id: string;
  /** Top-left of the label box. */
  x: number;
  y: number;
  width: number;
  height: number;
  side: LabelSide;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 5;
const SIDES: LabelSide[] = ['right', 'left', 'below', 'above'];

function boxFor(c: LabelCandidate, side: LabelSide): Box {
  switch (side) {
    case 'right':
      return { x: c.x + c.r + GAP, y: c.y - c.height / 2, width: c.width, height: c.height };
    case 'left':
      return { x: c.x - c.r - GAP - c.width, y: c.y - c.height / 2, width: c.width, height: c.height };
    case 'below':
      return { x: c.x - c.width / 2, y: c.y + c.r + GAP / 2, width: c.width, height: c.height };
    case 'above':
      return { x: c.x - c.width / 2, y: c.y - c.r - GAP / 2 - c.height, width: c.width, height: c.height };
  }
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(box: Box, width: number, height: number): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
}

export function placeLabels(candidates: readonly LabelCandidate[], viewport: { width: number; height: number }): PlacedLabel[] {
  const marks: (Box & { id: string })[] = candidates.map((c) => ({ id: c.id, x: c.x - c.r, y: c.y - c.r, width: 2 * c.r, height: 2 * c.r }));
  const placed: PlacedLabel[] = [];
  const order = [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const c of order) {
    for (const side of SIDES) {
      const box = boxFor(c, side);
      if (!inside(box, viewport.width, viewport.height)) continue;
      if (placed.some((p) => overlaps(p, box))) continue;
      if (marks.some((m) => m.id !== c.id && overlaps(m, box))) continue;
      placed.push({ id: c.id, ...box, side });
      break;
    }
  }
  return placed;
}

/** Trim a label to at most `max` characters on a word boundary, with an ellipsis. */
export function shorten(label: string, max = 34): string {
  const clean = label.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
