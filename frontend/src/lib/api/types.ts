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
