/**
 * The finished mark (`PUT|DELETE /documents/{ref}/reading/finished`): a document counted
 * as read through whatever its chapter positions say, set by hand or by moving on to the
 * next document of a collection.
 */
import type { ApiClient } from '../api/client';
import type { DocumentPublic } from '../api/types/documents';

type Api = Pick<ApiClient, 'put' | 'delete'>;

const path = (ref: string) => `documents/${encodeURIComponent(ref)}/reading/finished`;

/** `keepalive` lets the request outlive the page, for a mark sent as you follow a link. */
export function markFinished(api: Api, ref: string, finished: boolean, { keepalive = false } = {}): Promise<DocumentPublic> {
  return finished ? api.put<DocumentPublic>(path(ref), undefined, { keepalive }) : api.delete<DocumentPublic>(path(ref));
}
