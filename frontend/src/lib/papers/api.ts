/**
 * Papers API calls (docs/PAPERS.md §7), through an injected client: `serverApi()` in
 * page frontmatter, `browserApi` in islands, a fake in tests. Paths are relative to the
 * API prefix; `ref` is a document id or slug.
 */
import type { ApiClient, Query } from '../api/client';
import type { Page } from '../api/types';
import type { JobPublic } from '../api/types/jobs';
import type {
  CandidateStatus,
  PaperDetail,
  PaperMetaPublic,
  PaperMetaUpdate,
  PaperPage,
  PaperPassPublic,
  PaperQuery,
  PaperRatingCreate,
  PaperRatingPublic,
  PaperReferenceRow,
  PassNumber,
  ReadingCandidatePublic,
  CitationIntent,
} from '../api/types/papers';

type Reader = Pick<ApiClient, 'get'>;
type Writer = Pick<ApiClient, 'post' | 'put' | 'patch' | 'delete'>;

const paper = (ref: string) => `papers/${encodeURIComponent(ref)}`;

export function listPapers(api: Reader, query: PaperQuery = {}): Promise<PaperPage> {
  return api.get<PaperPage>('papers', { query: query as Query });
}

/** 404 unless the document is a paper. */
export function getPaper(api: Reader, ref: string): Promise<PaperDetail> {
  return api.get<PaperDetail>(paper(ref));
}

export function updatePaperMeta(api: Writer, ref: string, body: PaperMetaUpdate): Promise<PaperMetaPublic> {
  return api.patch<PaperMetaPublic>(`${paper(ref)}/meta`, body);
}

/** Queue an OpenAlex lookup (the live job comes back on a repeat). */
export function enrichPaper(api: Writer, ref: string): Promise<JobPublic> {
  return api.post<JobPublic>(`${paper(ref)}/enrich`);
}

export function ratePaper(api: Writer, ref: string, body: PaperRatingCreate): Promise<PaperRatingPublic> {
  return api.post<PaperRatingPublic>(`${paper(ref)}/ratings`, body);
}

/** Every rating, newest first. */
export function listRatings(api: Reader, ref: string): Promise<PaperRatingPublic[]> {
  return api.get<PaperRatingPublic[]>(`${paper(ref)}/ratings`);
}

/** Mark a pass done (keeps the first completion time, replaces the note). */
export function completePass(api: Writer, ref: string, pass: PassNumber, note: string | null = null): Promise<PaperPassPublic> {
  return api.put<PaperPassPublic>(`${paper(ref)}/passes/${pass}`, note ? { note } : {});
}

export async function undoPass(api: Writer, ref: string, pass: PassNumber): Promise<void> {
  await api.delete<unknown>(`${paper(ref)}/passes/${pass}`);
}

export function listReferences(
  api: Reader,
  ref: string,
  filter: { intent?: CitationIntent; on_shelf?: boolean } = {},
): Promise<PaperReferenceRow[]> {
  return api.get<PaperReferenceRow[]>(`${paper(ref)}/references`, { query: filter });
}

/** The reading queue; by default `suggested` and `queued`, best score first. */
export function listCandidates(
  api: Reader,
  query: { status?: CandidateStatus; limit?: number; offset?: number } = {},
): Promise<Page<ReadingCandidatePublic>> {
  return api.get<Page<ReadingCandidatePublic>>('papers/candidates', { query });
}

/** Queue or dismiss a candidate (`ingested` is set by ingesting it). */
export function setCandidateStatus(api: Writer, id: string, status: Exclude<CandidateStatus, 'ingested'>): Promise<ReadingCandidatePublic> {
  return api.patch<ReadingCandidatePublic>(`papers/candidates/${id}`, { status });
}

/** Download the candidate's PDF and put it on the shelf (a `paper_fetch` job). */
export function ingestCandidate(api: Writer, id: string): Promise<JobPublic> {
  return api.post<JobPublic>(`papers/candidates/${id}/ingest`);
}

export function refreshCandidates(api: Writer): Promise<JobPublic> {
  return api.post<JobPublic>('papers/candidates/refresh');
}

export function refreshWatch(api: Writer, force = false): Promise<JobPublic> {
  return api.post<JobPublic>('papers/watch/refresh', undefined, force ? { query: { force: true } } : {});
}
