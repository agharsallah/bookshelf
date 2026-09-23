/**
 * Note writes. `raw` is sent once and never edited (D11); only the colour changes.
 * The structured version is an artifact: accepting approves it, dismissing rejects
 * it, and either way the raw note stays exactly as typed.
 */
import type { ApiClient } from '../../lib/api/client';
import type { HighlightColor } from '../../lib/contract';
import type { NoteCreate, NoteCreated, NoteDetail, NoteRange } from '../../lib/api/types/notes';

export type NotesApi = Pick<ApiClient, 'post' | 'patch' | 'delete'>;

export interface NewNote {
  documentId: string;
  anchor: string;
  range: NoteRange | null;
  raw: string;
  color: HighlightColor | null;
}

/** Create a note and return it in list shape (no structured version yet). */
export async function createNote(api: NotesApi, note: NewNote): Promise<NoteDetail> {
  const body: NoteCreate = {
    document_id: note.documentId,
    anchor: note.anchor,
    raw: note.raw,
    ...(note.range ? { range: note.range } : {}),
    ...(note.color ? { color: note.color } : {}),
  };
  const created = await api.post<NoteCreated>('notes', body);
  return {
    id: created.id,
    document_id: created.document_id,
    anchor: created.anchor,
    range: created.range,
    raw: created.raw,
    color: created.color,
    created_at: created.created_at,
    structured: null,
    detached: false,
  };
}

export function recolorNote(api: NotesApi, id: string, color: HighlightColor | null): Promise<NoteDetail> {
  return api.patch<NoteDetail>(`notes/${id}`, { color });
}

export async function deleteNote(api: NotesApi, id: string): Promise<void> {
  await api.delete<unknown>(`notes/${id}`);
}

export function reviewStructured(api: NotesApi, artifactId: string, action: 'approve' | 'reject'): Promise<unknown> {
  return api.post(`artifacts/${artifactId}/review`, { action });
}
