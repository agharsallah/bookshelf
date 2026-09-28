/**
 * Response shapes shared by the UI. Kept deliberately small: page-building work adds
 * the resource types (documents, artifacts, notes, jobs…) as it consumes them.
 */

/** GET /health (served at the backend root; `/api/health` through the proxy). */
export interface Health {
  status: string;
  version: string;
  environment: string;
}

/**
 * GET /health/ready (backend root). `degraded` (still 200) when Qdrant is unreachable:
 * only vector search needs it. A database outage is a 503 error envelope instead.
 */
export interface Readiness {
  status: 'ready' | 'degraded';
  database: string;
  qdrant: 'ok' | 'unavailable';
  qdrant_error?: string | null;
}

/** Offset pagination envelope used by list endpoints. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type * from './types/artifacts';
export { ARTIFACT_TYPES, REVIEW_STATES, TIERS } from './types/artifacts';
export type * from './types/jobs';
export { JOB_KINDS, JOB_STATES } from './types/jobs';
export type * from './types/skills';
export type * from './types/documents';
export { CONTAINER_KINDS, DOCUMENT_STATUSES, KIND_LABELS, LEAF_KINDS, isContainer } from './types/documents';
export type * from './types/notes';
export type * from './types/search';
export { INTENTS, SEARCH_MODES } from './types/search';
export type * from './types/graph';
export { CONCEPT_KINDS, CONCEPT_SORTS, EDGE_STATUSES, ENTITY_KINDS, RELATIONS } from './types/graph';
