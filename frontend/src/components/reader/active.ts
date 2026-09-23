/**
 * Which block is "being read": the one crossing a reading line placed a little below
 * the top of the viewport. The distillation pane follows that block's section.
 */

export interface BlockBox {
  anchor: string;
  top: number;
  bottom: number;
}

/**
 * Pick the block under `line` (viewport px). If none crosses it (a gap between
 * blocks), the last block that starts above the line wins; if every block is below
 * it, the first one. Boxes may arrive in any order.
 */
export function pickActive(boxes: readonly BlockBox[], line: number): string | null {
  if (boxes.length === 0) return null;
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  const crossing = sorted.find((b) => b.top <= line && b.bottom > line);
  if (crossing) return crossing.anchor;
  const above = sorted.filter((b) => b.top <= line).at(-1);
  return (above ?? sorted[0])?.anchor ?? null;
}

/** Reading line: a third of the way down, never below 12rem-ish on tall screens. */
export function readingLine(viewportHeight: number): number {
  return Math.min(viewportHeight * 0.33, 220);
}
