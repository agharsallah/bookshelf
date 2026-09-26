/**
 * What the contents list says about each chapter, kept out of the components so it can
 * be tested: where its title leads (continue, read again or start), the one status worth
 * flagging on its row, and the line above the list summing the book up.
 */
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import type { ChapterStatus } from '../../lib/documents/artifacts';
import { isFinished } from '../../lib/documents/reading';
import { plural } from '../library/spine';

export interface ReadLink {
  anchor: string;
  label: string;
}

/** Continue where you left off, read a finished chapter again, or start it. */
export function readLink(position: ReadingPosition | undefined, unit: Pick<TreeNode, 'anchor'>): ReadLink {
  if (!position || position.progress === 0) return { anchor: unit.anchor, label: 'Read' };
  if (isFinished(position.progress)) return { anchor: unit.anchor, label: 'Read again' };
  return { anchor: position.anchor, label: 'Continue reading' };
}

export type BadgeTone = 'done' | 'attention' | 'quiet';

export interface ChapterBadge {
  tone: BadgeTone;
  text: string;
  /** Where the badge leads, when there is something to do about it. */
  href?: string;
}

/**
 * The one thing a chapter's row says about its artifacts: drafts to review first, then
 * how far the distillation got. Rows that are done say so quietly, so the exceptions stand
 * out; front matter and skipped chapters say nothing, as they are not distilled.
 */
export function chapterBadge(status: ChapterStatus | undefined, unit: Pick<TreeNode, 'meta'>): ChapterBadge | null {
  if (status && status.waiting > 0) return { tone: 'attention', text: `${status.waiting} to review`, href: '/review' };
  if (unit.meta.front_matter || unit.meta.skip) return null;
  if (status?.distillation === 'approved') return { tone: 'done', text: 'Distilled' };
  if (status?.distillation) return { tone: 'attention', text: 'Distillation in review', href: '/review' };
  if (status?.summary === 'approved') return { tone: 'quiet', text: 'Summarized' };
  return { tone: 'quiet', text: 'Not distilled' };
}

export interface ContentsSummary {
  /** What a reader needs: "29 chapters". */
  chapters: string;
  /** What the workshop adds: "all distilled · 3 to review", or null when there is nothing to say. */
  work: string | null;
}

/** "29 chapters", then "18 distilled · 3 to review" for the workshop: the list at a glance. */
export function contentsSummary(units: readonly Pick<TreeNode, 'anchor' | 'meta'>[], statuses: Record<string, ChapterStatus>): ContentsSummary {
  const chapters = units.filter((u) => !u.meta.front_matter);
  const distillable = chapters.filter((u) => !u.meta.skip);
  const distilled = distillable.filter((u) => statuses[u.anchor]?.distillation === 'approved').length;
  const waiting = units.reduce((sum, u) => sum + (statuses[u.anchor]?.waiting ?? 0), 0);
  const work = [
    distillable.length > 0 ? (distilled === distillable.length ? 'all distilled' : `${distilled} distilled`) : null,
    waiting > 0 ? `${waiting} to review` : null,
  ].filter(Boolean);
  return { chapters: plural(chapters.length, 'chapter'), work: work.length > 0 ? work.join(' · ') : null };
}
