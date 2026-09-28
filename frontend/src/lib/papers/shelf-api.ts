/**
 * Shelf-level paper calls (docs/PAPERS.md §7): the results comparison and paper sets with
 * their syntheses. Same injected-client pattern as `./api`.
 */
import type { ApiClient } from '../api/client';
import type { Page } from '../api/types';
import type { JobPublic } from '../api/types/jobs';
import type {
  PaperSetCreate,
  PaperSetDetail,
  PaperSetPublic,
  PaperSynthesisDetail,
  ResultsComparison,
  SynthesisVerdict,
} from '../api/types/paperShelf';

type Reader = Pick<ApiClient, 'get'>;
type Writer = Pick<ApiClient, 'post' | 'delete'>;

const set = (id: string) => `paper-sets/${encodeURIComponent(id)}`;

/** Pivot the approved results tables of 1–20 papers (ids or slugs). */
export function comparePapers(api: Reader, ids: readonly string[]): Promise<ResultsComparison> {
  return api.get<ResultsComparison>('papers/compare', { query: { ids: ids.join(',') } });
}

export function createPaperSet(api: Writer, body: PaperSetCreate): Promise<PaperSetPublic> {
  return api.post<PaperSetPublic>('paper-sets', body);
}

export function listPaperSets(api: Reader, query: { limit?: number; offset?: number } = {}): Promise<Page<PaperSetPublic>> {
  return api.get<Page<PaperSetPublic>>('paper-sets', { query });
}

export function getPaperSet(api: Reader, id: string): Promise<PaperSetDetail> {
  return api.get<PaperSetDetail>(set(id));
}

export async function deletePaperSet(api: Writer, id: string): Promise<void> {
  await api.delete<unknown>(set(id));
}

/** Queue `synthesize_papers` (the live job comes back on a repeat; `force` re-runs it). */
export function synthesizeSet(api: Writer, id: string, force = false): Promise<JobPublic> {
  return api.post<JobPublic>(`${set(id)}/synthesis`, undefined, force ? { query: { force: true } } : {});
}

/** The latest approved synthesis, else the latest draft; one version by number. */
export function getSynthesis(api: Reader, id: string, version?: number): Promise<PaperSynthesisDetail> {
  return api.get<PaperSynthesisDetail>(`${set(id)}/synthesis`, version === undefined ? {} : { query: { version } });
}

/** Answers the version without its `sources` (the backend's `PaperSynthesisPublic`). */
export function reviewSynthesis(api: Writer, id: string, version: number, verdict: SynthesisVerdict): Promise<Omit<PaperSynthesisDetail, 'sources'>> {
  return api.post<Omit<PaperSynthesisDetail, 'sources'>>(`${set(id)}/synthesis/${version}/review`, { verdict });
}
