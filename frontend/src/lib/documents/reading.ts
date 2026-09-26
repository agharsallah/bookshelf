/**
 * Reading progress over the book's chapters (`GET /documents/{ref}/reading`): where to
 * continue, how far through each chapter you got, and how much of the book that is.
 * Positions for chapters that no longer exist (after a re-parse) are ignored.
 */
import type { ReadingPosition, TreeNode } from '../api/types/documents';

/** From here on a chapter counts as read: the last lines rarely cross the reading line. */
export const FINISHED = 0.97;

export const isFinished = (progress: number): boolean => progress >= FINISHED;

/** 0–1 as a whole percentage, never showing 100 before the chapter is finished. */
export function percent(progress: number): number {
  const value = Math.round(progress * 100);
  return isFinished(progress) ? 100 : Math.min(value, 99);
}

/** Positions keyed by chapter anchor, only for chapters of `units`. */
export function positionsByUnit(
  positions: readonly ReadingPosition[],
  units: readonly Pick<TreeNode, 'anchor'>[],
): Record<string, ReadingPosition> {
  const known = new Set(units.map((u) => u.anchor));
  return Object.fromEntries(positions.filter((p) => known.has(p.unit)).map((p) => [p.unit, p]));
}

export interface ContinueTarget {
  unit: TreeNode;
  /** Where to open the reader. */
  anchor: string;
  progress: number;
  /** `continue` picks up in the chapter last read; `next` starts the one after a finished chapter. */
  kind: 'continue' | 'next';
}

/**
 * Where "continue reading" goes: the chapter read most recently, or when that one is
 * finished, the next chapter not yet finished. Null when nothing was read, or nothing is left.
 */
export function continueTarget(positions: readonly ReadingPosition[], units: readonly TreeNode[]): ContinueTarget | null {
  const byUnit = positionsByUnit(positions, units);
  const latest = [...Object.values(byUnit)].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!latest) return null;
  const at = units.findIndex((u) => u.anchor === latest.unit);
  const unit = units[at];
  if (!unit) return null;
  if (!isFinished(latest.progress)) return { unit, anchor: latest.anchor, progress: latest.progress, kind: 'continue' };
  const next = units.slice(at + 1).find((u) => !u.meta.front_matter && !isFinished(byUnit[u.anchor]?.progress ?? 0));
  if (!next) return null;
  const saved = byUnit[next.anchor];
  return { unit: next, anchor: saved?.anchor ?? next.anchor, progress: saved?.progress ?? 0, kind: 'next' };
}

/** A chapter's share of the book: its page span, or one page when it has none. */
function weight(unit: Pick<TreeNode, 'page_from' | 'page_to'>): number {
  const { page_from: from, page_to: to } = unit;
  return from !== null && to !== null && to >= from ? to - from + 1 : 1;
}

export interface BookProgress {
  /** 0–1 of the book's pages. */
  progress: number;
  finished: number;
  /** Chapters that count: front matter only once you have read some of it. */
  total: number;
}

/** How much of the book is read, weighting each chapter by its pages. */
export function bookProgress(positions: readonly ReadingPosition[], units: readonly TreeNode[]): BookProgress {
  const byUnit = positionsByUnit(positions, units);
  const counted = units.filter((u) => !u.meta.front_matter || byUnit[u.anchor]);
  let read = 0;
  let pages = 0;
  let finished = 0;
  for (const unit of counted) {
    const progress = byUnit[unit.anchor]?.progress ?? 0;
    const share = weight(unit);
    pages += share;
    read += (isFinished(progress) ? 1 : progress) * share;
    if (isFinished(progress)) finished += 1;
  }
  return { progress: pages ? read / pages : 0, finished, total: counted.length };
}
