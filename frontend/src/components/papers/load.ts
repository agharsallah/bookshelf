/**
 * Server-side loading for the paper pages (frontmatter only: uses `serverApi`). The
 * page loads the paper and your ratings once; each tab view loads what it shows.
 */
import type { Page } from '../../lib/api/types';
import type { ArtifactListItem } from '../../lib/api/types/artifacts';
import type { JobPublic } from '../../lib/api/types/jobs';
import type { PaperDetail, PaperRatingPublic } from '../../lib/api/types/papers';
import { serverApi } from '../../lib/api/server';
import { getArtifacts, getOutline } from '../../lib/documents/server';
import { getPaper, listRatings } from '../../lib/papers/api';
import { passageUnitsOf, type PassageUnit } from '../guide/passage';

export interface PaperPageData {
  paper: PaperDetail;
  ratings: PaperRatingPublic[];
}

/** The paper (404 unless the document is a paper) and every rating of it. */
export async function loadPaper(ref: string): Promise<PaperPageData> {
  const paper = await getPaper(serverApi(), ref);
  const ratings = await listRatings(serverApi(), paper.slug);
  return { paper, ratings };
}

/** Where a cite can open in place: every section of the paper, numbered as in the paper. */
export async function passageUnits(slug: string): Promise<PassageUnit[]> {
  return passageUnitsOf((await getOutline(slug)).nodes);
}

/** Every version of one paper artifact type (the tab picks which to show). */
export function paperArtifacts(documentId: string, type: ArtifactListItem['type']): Promise<ArtifactListItem[]> {
  return getArtifacts(documentId, { type });
}

/** The paper's recent jobs, to follow one already under way; best effort. */
export async function recentJobs(documentId: string): Promise<JobPublic[]> {
  try {
    return (await serverApi().get<Page<JobPublic>>('jobs', { query: { document_id: documentId, limit: 50 } })).items;
  } catch {
    return [];
  }
}
