/**
 * Search wire shapes (backend/app/schemas/search.py): `POST /search`, the
 * `POST /search/answer` event stream and `GET /search/suggest`.
 *
 * Scores are comparable within one response only (cross-encoder, `ts_rank_cd` or 1.0).
 */
import type { RenderBlock } from '../../contract';
import type { ArtifactType } from './artifacts';

export const SEARCH_MODES = ['auto', 'addressed', 'discovery', 'synthesis', 'lexical'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const INTENTS = ['addressed', 'discovery', 'synthesis', 'lexical'] as const;
export type Intent = (typeof INTENTS)[number];

export interface SearchFilters {
  document_ids?: string[] | null;
  tags?: string[] | null;
  /** Artifact types of distillation hits. */
  types?: ArtifactType[] | null;
}

export interface SearchRequest {
  query: string;
  mode?: SearchMode;
  filters?: SearchFilters;
  /** Maximum number of documents, 1–20 (default 5). */
  limit?: number;
}

/** A document as search results carry it. */
export interface SearchDocument {
  id: string;
  slug: string;
  title: string;
  authors: string[];
}

/** Where an addressed query landed; `anchor` is null for the whole document. */
export interface ResolvedAddress {
  document: SearchDocument;
  anchor: string | null;
}

export interface SearchHit {
  kind: 'distillation' | 'block';
  /** Block address; null for document-scope artifacts. */
  anchor: string | null;
  /** Distillation hits only. */
  type?: ArtifactType | null;
  artifact_id?: string | null;
  /** The enclosing chapter/section. */
  heading?: string | null;
  score: number;
  snippet: string;
  /** Lexical hits: `[start, end)` character ranges in `snippet`. */
  highlights?: [number, number][] | null;
  /** Addressed hits: the artifact body as render blocks. */
  blocks?: RenderBlock[] | null;
}

export interface SearchGroup {
  document: SearchDocument;
  hits: SearchHit[];
}

export interface ConceptEnd {
  id: string;
  canonical: string;
}

/** An accepted edge between two concepts, evidenced in the result documents. */
export interface ConceptRelation {
  relation: 'contradicts' | 'supports' | 'extends';
  src: ConceptEnd;
  dst: ConceptEnd;
  weight: number;
  /** `<slug>:<anchor>` passages in the result documents. */
  evidence: string[];
}

/**
 * Vector intents only: `empty` (nothing indexed yet) or `unavailable` (Qdrant
 * unreachable) explain empty `groups`; addressed and lexical never set it.
 */
export type IndexState = 'ready' | 'empty' | 'unavailable';

export interface SearchResponse {
  intent: Intent;
  resolved?: ResolvedAddress | null;
  groups: SearchGroup[];
  /** Synthesis only: relations between concepts in the result books, contradictions first. */
  relations?: ConceptRelation[];
  index_state?: IndexState | null;
  took_ms: number;
}

// --- Answer stream (SSE) --------------------------------------------------------------

export type AnswerStage = 'routing' | 'searching' | 'writing';

/** `event: status`. */
export interface AnswerStatus {
  stage: AnswerStage;
  message: string;
}

/** What one qualified cite (`<slug>:<anchor>`) points at. */
export interface CiteSource {
  document: SearchDocument;
  anchor: string;
}

/** `event: answer`: blocks whose cites are `<slug>:<anchor>` keys of `sources`. */
export interface AnswerPayload {
  blocks: RenderBlock[];
  sources: Record<string, CiteSource>;
  /** Cites the model produced that were not in the evidence set (removed). */
  dropped_cites: string[];
  model: string | null;
}

/** `event: error`; the stream ends after it. */
export interface AnswerError {
  code: string;
  message: string;
}

// --- Suggest --------------------------------------------------------------------------

/**
 * Documents and chapters carry `document` and chapters their `anchor`; concepts (and
 * documents) carry `id`.
 */
export interface SuggestItem {
  kind: 'document' | 'chapter' | 'concept';
  label: string;
  id?: string | null;
  document?: SearchDocument | null;
  anchor?: string | null;
}

export interface SuggestResponse {
  items: SuggestItem[];
}
