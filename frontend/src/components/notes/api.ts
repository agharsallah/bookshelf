/**
 * Note writes. A plain highlight is sent without `raw` (no model call); words are set
 * once, at creation or later on a highlight (`PATCH {raw}`), and never edited (D11).
 * The colour may change any time. The structured version is an artifact: accepting
 * approves it, dismissing rejects it, and either way the raw note stays as typed.
 */
import type { ApiClient } from '../../lib/api/client';
import type { HighlightColor } from '../../lib/contract';
import type { NoteCreate, NoteCreated, NoteDetail, NoteRange } from '../../lib/api/types/notes';

export type NotesApi = Pick<ApiClient, 'get' | 'post' | 'patch' | 'delete'>;

export interface NewNote {
  documentId: string;
  anchor: string;
  range: NoteRange | null;
  /** Your words; null (or blank) for a plain highlight. */
  raw: string | null;
  color: HighlightColor | null;
}

/** Create a note and return it in list shape (no structured version yet). */
export async function createNote(api: NotesApi, note: NewNote): Promise<NoteDetail> {
  const body: NoteCreate = {
    document_id: note.documentId,
    anchor: note.anchor,
    ...(note.raw?.trim() ? { raw: note.raw } : {}),
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

/** Give a plain highlight its words, once; `409` when the note already has some (D11). */
export function addWords(api: NotesApi, id: string, raw: string): Promise<NoteDetail> {
  return api.patch<NoteDetail>(`notes/${id}`, { raw });
}

export function getNote(api: NotesApi, id: string): Promise<NoteDetail> {
  return api.get<NoteDetail>(`notes/${id}`);
}

export async function deleteNote(api: NotesApi, id: string): Promise<void> {
  await api.delete<unknown>(`notes/${id}`);
}

export function reviewStructured(api: NotesApi, artifactId: string, action: 'approve' | 'reject'): Promise<unknown> {
  return api.post(`artifacts/${artifactId}/review`, { action });
}
