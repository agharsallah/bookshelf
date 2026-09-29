/**
 * Collection calls behind `/collections`. Same injected-client pattern as the other API
 * modules: pass `browserApi` from islands, `serverApi()` from page frontmatter.
 */
import type { ApiClient } from '../api/client';
import type {
  CollectionCreate,
  CollectionDetail,
  CollectionMemberPublic,
  CollectionPublic,
  CollectionUpdate,
} from '../api/types/collections';

type Reader = Pick<ApiClient, 'get'>;

const one = (ref: string) => `collections/${encodeURIComponent(ref)}`;
const member = (ref: string, documentId: string) => `${one(ref)}/members/${encodeURIComponent(documentId)}`;

/** Every collection by name; with `documentId`, only those holding that document. */
export function listCollections(api: Reader, documentId?: string): Promise<CollectionPublic[]> {
  return api.get<CollectionPublic[]>('collections', documentId ? { query: { document_id: documentId } } : {});
}

export function getCollection(api: Reader, ref: string): Promise<CollectionDetail> {
  return api.get<CollectionDetail>(one(ref));
}

export function createCollection(api: Pick<ApiClient, 'post'>, body: CollectionCreate): Promise<CollectionPublic> {
  return api.post<CollectionPublic>('collections', body);
}

export function updateCollection(api: Pick<ApiClient, 'patch'>, ref: string, body: CollectionUpdate): Promise<CollectionPublic> {
  return api.patch<CollectionPublic>(one(ref), body);
}

export async function deleteCollection(api: Pick<ApiClient, 'delete'>, ref: string): Promise<void> {
  await api.delete<unknown>(one(ref));
}

/** Add a document at the end, or change its note (`note` is only sent when given). */
export function putMember(api: Pick<ApiClient, 'put'>, ref: string, documentId: string, note?: string | null): Promise<CollectionMemberPublic> {
  return api.put<CollectionMemberPublic>(member(ref, documentId), note === undefined ? undefined : { note });
}

export async function removeMember(api: Pick<ApiClient, 'delete'>, ref: string, documentId: string): Promise<void> {
  await api.delete<unknown>(member(ref, documentId));
}

/** `documentIds` names every member once, in the new order. */
export function reorderCollection(api: Pick<ApiClient, 'put'>, ref: string, documentIds: string[]): Promise<CollectionPublic> {
  return api.put<CollectionPublic>(`${one(ref)}/order`, { document_ids: documentIds });
}
