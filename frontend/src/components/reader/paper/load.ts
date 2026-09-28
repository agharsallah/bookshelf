/**
 * The read page's paper extras (server-side, frontmatter only): passes, unit roles, the
 * unit's claim marks, the notation table and the review questions. Each piece is best
 * effort: a paper still reads (in every pass) when one of them fails or does not exist.
 * Bodies are read with the paper tabs' parsers (components/papers/study-bodies.ts).
 */
import type { ApiClient } from '../../../lib/api/client';
import type { ArtifactPublic } from '../../../lib/api/types/artifacts';
import type { TreeNode } from '../../../lib/api/types/documents';
import type { ClaimMarks } from '../../../lib/api/types/paperStudy';
import type { PaperDetail } from '../../../lib/api/types/papers';
import { pickBest } from '../../../lib/documents/artifacts';
import { getClaimMarks } from '../../../lib/papers/claims-api';
import { getPaper } from '../../../lib/papers/api';
import { placeSymbols, prepareSymbols } from '../../papers/notation';
import { parseNotation, parseReview } from '../../papers/study-bodies';
import type { PaperNotation, PaperReading, PaperUnit } from './types';

type Reader = Pick<ApiClient, 'get'>;
type ArtifactsOf = (type: 'notation_table' | 'paper_review') => Promise<ArtifactPublic[]>;
type RenderMath = (latex: string) => Promise<string>;

export function paperUnits(units: readonly TreeNode[]): PaperUnit[] {
  return units.map((u, i) => ({
    anchor: u.anchor,
    heading: u.heading ?? `Section ${i + 1}`,
    role: typeof u.meta.role === 'string' ? u.meta.role : null,
  }));
}

export interface PaperLoadOptions {
  api: Reader;
  slug: string;
  unit: string;
  units: readonly TreeNode[];
  artifactsOf: ArtifactsOf;
  renderMath: RenderMath;
}

export async function loadPaperReading({ api, slug, unit, units, artifactsOf, renderMath }: PaperLoadOptions): Promise<PaperReading> {
  const [detail, marks, notationList, reviewList] = await Promise.all([
    getPaper(api, slug).catch((): PaperDetail | null => null),
    getClaimMarks(api, slug, unit).catch((): ClaimMarks | null => null),
    artifactsOf('notation_table').catch((): ArtifactPublic[] => []),
    artifactsOf('paper_review').catch((): ArtifactPublic[] => []),
  ]);
  const notationChosen = pickBest(notationList, 'notation_table', null);
  const notation: PaperNotation | null = notationChosen
    ? {
        artifactId: notationChosen.artifact.id,
        standing: notationChosen.standing === 'approved' ? 'approved' : 'draft',
        symbols: placeSymbols(await prepareSymbols(parseNotation(notationChosen.artifact.body), renderMath), units),
      }
    : null;
  const review = pickBest(reviewList, 'paper_review', null);
  return {
    passes: detail?.passes ?? [],
    units: paperUnits(units),
    marks: marks?.marks ?? [],
    notation,
    questions: review ? parseReview(review.artifact.body).questions : [],
  };
}
