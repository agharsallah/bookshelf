/**
 * Choosing which artifact version to show. Approved beats unapproved; within the
 * same standing the newest version wins; rejected versions are never shown.
 */
import type { ArtifactPublic, ArtifactType, Review } from '../api/types/artifacts';
import { isUnder } from './tree';

export type Standing = 'approved' | 'draft' | 'needs_review';

export interface Chosen<A extends ArtifactPublic = ArtifactPublic> {
  artifact: A;
  /** Approved, or an unapproved draft the UI must badge as such. */
  standing: Standing;
}

function standingOf(review: Review): Standing | null {
  return review === 'rejected' ? null : review;
}

/** The best version of one scope (`type` at exactly `anchor`), or null. */
export function pickBest<A extends ArtifactPublic>(
  artifacts: readonly A[],
  type: ArtifactType,
  anchor: string | null,
): Chosen<A> | null {
  let best: A | null = null;
  for (const artifact of artifacts) {
    if (artifact.type !== type || artifact.anchor !== anchor || artifact.review === 'rejected') continue;
    if (!best) {
      best = artifact;
      continue;
    }
    const approved = artifact.review === 'approved';
    const bestApproved = best.review === 'approved';
    if (approved !== bestApproved ? approved : artifact.version > best.version) best = artifact;
  }
  if (!best) return null;
  return { artifact: best, standing: standingOf(best.review) ?? 'draft' };
}

/** Best version per anchor for a type, for every anchor under `prefix`, in anchor order. */
export function pickBestUnder<A extends ArtifactPublic>(
  artifacts: readonly A[],
  type: ArtifactType,
  prefix: string,
): Chosen<A>[] {
  const anchors = new Set<string>();
  for (const a of artifacts) {
    if (a.type === type && a.anchor !== null && isUnder(a.anchor, prefix)) anchors.add(a.anchor);
  }
  return [...anchors]
    .sort(compareAnchors)
    .map((anchor) => pickBest(artifacts, type, anchor))
    .filter((c): c is Chosen<A> => c !== null);
}

/** Natural anchor order: `ch2/s10` after `ch2/s9`. */
export function compareAnchors(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

export interface ChapterStatus {
  summary: Standing | null;
  distillation: Standing | null;
  /** Unapproved artifacts anywhere in the chapter (sections, figures…), as the queue counts them. */
  waiting: number;
}

/** What exists for a chapter, for the outline chips. Superseded drafts wait for nobody. */
export function chapterStatus(artifacts: readonly (ArtifactPublic & { superseded?: boolean })[], chapter: string): ChapterStatus {
  const waiting = new Set<string>();
  for (const a of artifacts) {
    if (a.superseded) continue;
    if (a.anchor !== null && isUnder(a.anchor, chapter) && (a.review === 'draft' || a.review === 'needs_review')) {
      waiting.add(`${a.type}@${a.anchor}`);
    }
  }
  return {
    summary: pickBest(artifacts, 'chapter_summary', chapter)?.standing ?? null,
    distillation: pickBest(artifacts, 'chapter_distillation', chapter)?.standing ?? null,
    waiting: waiting.size,
  };
}

/** Explanations of non-prose blocks, keyed by the block they explain. */
export const EXPLANATION_TYPES = [
  'figure_description',
  'table_explanation',
  'code_explanation',
  'math_description',
] as const satisfies readonly ArtifactType[];
