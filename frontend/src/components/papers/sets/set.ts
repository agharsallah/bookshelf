/**
 * A paper set's synthesis, ready to draw (`/papers/sets/[id]`): its blocks with the
 * at-a-glance table after them, its cross-paper cites (`<slug>:<anchor>`) resolved through
 * `sources` to the right paper's reader (lettered A, B, C… in set order), which versions
 * exist, and the synthesis job of this set if one is under way.
 */
import type { JobPublic } from '../../../lib/api/types/jobs';
import type { PaperSynthesisDetail, SynthesisBody } from '../../../lib/api/types/paperShelf';
import type { Review } from '../../../lib/api/types/artifacts';
import { collectCites, type RenderBlock } from '../../../lib/contract';
import { indexCites, type CiteIndex } from '../../search/cites';

export const REVIEW_WORDS: Record<Review, string> = {
  draft: 'Draft',
  needs_review: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
};

function isBlock(value: unknown): value is RenderBlock {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** The body's blocks, then its table (a `table` block), tolerant of a malformed body. */
export function synthesisBlocks(body: SynthesisBody | null | undefined): RenderBlock[] {
  const blocks = Array.isArray(body?.blocks) ? body.blocks.filter(isBlock) : [];
  return isBlock(body?.table) ? [...blocks, body.table] : blocks;
}

/**
 * Cite chips for the synthesis, linking into each paper's reader. Papers are lettered in
 * set order (`members`, slugs) so the list beside the text reads A, B, C…; a cited paper
 * that is no longer a member follows, by first cite.
 */
export function synthesisCites(detail: Pick<PaperSynthesisDetail, 'sources' | 'body'>, members: readonly string[] = []): CiteIndex {
  const cited = collectCites(synthesisBlocks(detail.body));
  const keys = Object.keys(detail.sources);
  const bySet = members.flatMap((slug) => keys.filter((k) => detail.sources[k]?.document.slug === slug));
  return indexCites(detail.sources, [...bySet, ...cited]);
}

/**
 * Every version number up to the newest: versions are numbered 1, 2, 3… per set, so the
 * newest is found by asking for the next one until there is none. `exists` asks the API.
 */
export async function knownVersions(served: number, exists: (version: number) => Promise<boolean>, limit = 20): Promise<number[]> {
  let newest = served;
  while (newest - served < limit && (await exists(newest + 1))) newest += 1;
  return Array.from({ length: newest }, (_, i) => i + 1);
}

/** `?version=` as a positive whole number, else null (the default version). */
export function versionParam(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** Approve or reject: only a version nobody has judged yet (a rejected one can be approved). */
export function verdictsFor(review: Review): ('approve' | 'reject')[] {
  if (review === 'approved') return ['reject'];
  if (review === 'rejected') return ['approve'];
  return ['approve', 'reject'];
}

/** The newest queued or running synthesis job of this set. */
export function liveSetJob(jobs: readonly JobPublic[], setId: string): JobPublic | null {
  return (
    jobs
      .filter((j) => j.kind === 'synthesize_papers' && (j.state === 'queued' || j.state === 'running') && j.payload?.set_id === setId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}
