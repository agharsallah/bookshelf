/**
 * Notes and highlights (backend/app/schemas/note.py). `raw` is your words, set once
 * and never edited (D11). A plain highlight has no `raw` (no model call) and may be
 * given words exactly once. The structured version is a separate derived artifact
 * (`structured_note`).
 */
import type { Review } from './artifacts';
import type { HighlightColor, RenderBlock } from '../../contract';
import type { JobPublic } from './jobs';

/** Character offsets into the node's `text`: `0 <= start < end <= len(text)`. */
export interface NoteRange {
  start: number;
  end: number;
}

/** `POST /notes`. Omit `raw` for a plain highlight. */
export interface NoteCreate {
  document_id: string;
  anchor: string;
  range?: NoteRange | null;
  raw?: string;
  color?: HighlightColor | null;
}

/**
 * `PATCH /notes/{id}`: `color` any time (`null` clears it); `raw` only while the note
 * has none; a note that already has words answers 409 (D11).
 */
export type NoteUpdate = { color: HighlightColor | null; raw?: string } | { raw: string };

export interface NotePublic {
  id: string;
  document_id: string;
  anchor: string;
  range: NoteRange | null;
  /** Null for a plain highlight. */
  raw: string | null;
  color: HighlightColor | null;
  created_at: string;
}

/** The body of a `structured_note` artifact (skills/structure-note/schema.json). */
export interface StructuredNoteBody {
  blocks: RenderBlock[];
  tags?: string[];
  concepts?: string[];
}

/** The newest `structured_note` artifact for a note. */
export interface StructuredNote {
  id: string;
  version: number;
  review: Review;
  skill_version: string | null;
  body: StructuredNoteBody;
  created_at: string;
}

/** `GET /notes` item. */
export interface NoteDetail extends NotePublic {
  structured: StructuredNote | null;
  /** True when the anchor no longer exists after a re-parse. */
  detached: boolean;
}

/** `201` body of `POST /notes`: the stored note plus its `structure_note` job (null for a highlight). */
export interface NoteCreated extends NotePublic {
  job: JobPublic | null;
}
