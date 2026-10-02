/**
 * The book as a strip of chapters: each segment as wide as the chapter's pages, filled
 * as far as you have read it, the one you are in marked with the highlighter.
 */
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import { anchorLabel } from '../../lib/anchors';
import { isFinished } from '../../lib/documents/reading';
import { inCollection } from '../collections/path';

export interface StripSegment {
  anchor: string;
  /** Where the segment opens the reader: your place in it, else its start. */
  href: string;
  title: string;
  /** Share of the strip, 0–1; all shares sum to 1. */
  share: number;
  progress: number;
  finished: boolean;
  current: boolean;
  front: boolean;
}

function pages(unit: Pick<TreeNode, 'page_from' | 'page_to'>): number {
  const { page_from: from, page_to: to } = unit;
  return from !== null && to !== null && to >= from ? to - from + 1 : 1;
}

export function stripSegments(
  slug: string,
  units: readonly TreeNode[],
  positions: Record<string, ReadingPosition>,
  current: string | null = null,
  collection: string | null = null,
): StripSegment[] {
  const total = units.reduce((sum, u) => sum + pages(u), 0) || 1;
  return units.map((unit) => {
    const position = positions[unit.anchor];
    const progress = position?.progress ?? 0;
    const label = unit.meta.front_matter ? null : anchorLabel(unit.anchor);
    const finished = isFinished(progress);
    return {
      anchor: unit.anchor,
      href: inCollection(`/documents/${slug}/read/${position && !finished ? position.anchor : unit.anchor}`, collection),
      title: [label, unit.heading ?? unit.anchor].filter(Boolean).join(' · '),
      share: pages(unit) / total,
      progress: finished ? 1 : progress,
      finished,
      current: unit.anchor === current,
      front: Boolean(unit.meta.front_matter),
    };
  });
}
