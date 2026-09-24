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

/** What a note marks: the source text, or a passage of the chapter distillation/summary. */
export type NoteTarget = 'source' | 'chapter_distillation' | 'chapter_summary';

/**
 * `POST /notes`. Omit `raw` for a plain highlight. With `artifact_id` the note marks a
 * passage of a distillation or summary: `anchor` is the artifact's, `range` is into
 * render block `block`'s text, and `quote` is exactly the marked words.
 */
export interface NoteCreate {
  document_id: string;
  anchor: string;
  range?: NoteRange | null;
  raw?: string;
  color?: HighlightColor | null;
  artifact_id?: string;
  block?: number;
  quote?: string;
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
  target: NoteTarget;
  /** The artifact a pane note marks (null for the source, or once it was deleted). */
  artifact_id: string | null;
  block: number | null;
  quote: string | null;
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
  /** True when what the note marks no longer exists (re-parse, or its artifact was deleted). */
  detached: boolean;
  /** The marked words; null for a whole-block note or a detached one. */
  passage: string | null;
}

/** `201` body of `POST /notes`: the stored note plus its `structure_note` job (null for a highlight). */
export interface NoteCreated extends NotePublic {
  job: JobPublic | null;
}
