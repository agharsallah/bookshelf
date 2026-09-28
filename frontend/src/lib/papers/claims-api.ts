/**
 * The claim tracker's calls (docs/PAPERS.md §5, §7), through an injected client like
 * ./api: a paper's claims, one claim's cross-paper relations, the reader's margin
 * marks, the "find relations" pass, and accepting or rejecting a proposed relation
 * (a claim ↔ claim edge, `PATCH /edges/{id}`).
 */
import type { ApiClient } from '../api/client';
import type { EdgeStatus } from '../api/types/graph';
import type { ClaimMarks, ClaimRelations, PaperClaims, RelateQueued } from '../api/types/paperStudy';

type Reader = Pick<ApiClient, 'get'>;
type Writer = Pick<ApiClient, 'post' | 'patch'>;

/** Claims of the approved claim_set, grouped by unit, with relation counts. */
export function getPaperClaims(api: Reader, ref: string): Promise<PaperClaims> {
  return api.get<PaperClaims>(`papers/${encodeURIComponent(ref)}/claims`);
}

export function getClaimRelations(api: Reader, claimId: string): Promise<ClaimRelations> {
  return api.get<ClaimRelations>(`claims/${encodeURIComponent(claimId)}/relations`);
}

/** Evidence anchor → claims resting on it, for the reader's margin (`unit` limits it). */
export function getClaimMarks(api: Reader, ref: string, unit?: string): Promise<ClaimMarks> {
  return api.get<ClaimMarks>(`documents/${encodeURIComponent(ref)}/claims/marks`, unit ? { query: { unit } } : {});
}

/** Queue the cross-paper pass for one paper (or every paper with claims). */
export function relateClaims(api: Writer, ref?: string): Promise<RelateQueued> {
  return api.post<RelateQueued>('papers/claims/relate', undefined, ref ? { query: { document: ref } } : {});
}

/** Accept or reject a proposed relation. */
export async function reviewRelation(api: Writer, edgeId: string, status: Exclude<EdgeStatus, 'proposed'>): Promise<void> {
  await api.patch<unknown>(`edges/${encodeURIComponent(edgeId)}`, { status });
}
