/**
 * Putting a document away: archive it (off the shelf, search and reviews, nothing lost),
 * restore it, or delete it for good, optionally with its original file in `library/`.
 */
import type { ApiClient } from '../api/client';
import type { DocumentPublic, DocumentRestored } from '../api/types/documents';

type Api = Pick<ApiClient, 'post' | 'delete'>;

const path = (ref: string) => `documents/${encodeURIComponent(ref)}`;

export function archiveDocument(api: Api, ref: string): Promise<DocumentPublic> {
  return api.post<DocumentPublic>(`${path(ref)}/archive`);
}

export function restoreDocument(api: Api, ref: string): Promise<DocumentRestored> {
  return api.post<DocumentRestored>(`${path(ref)}/restore`);
}

/** Deletes the document and everything made from it; `file` deletes the original too. */
export async function deleteDocument(api: Api, ref: string, { file = false }: { file?: boolean } = {}): Promise<void> {
  await api.delete<unknown>(path(ref), file ? { query: { file: true } } : undefined);
}

/** "3 October 2026", as the document page writes dates. */
export function archivedOn(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
