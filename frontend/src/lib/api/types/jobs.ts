/** Job queue wire shapes (backend/app/schemas/job.py, app/models/enums.py). */
import type { RunMode } from './artifacts';

export const JOB_KINDS = [
  'parse',
  'describe_figure',
  'explain_code',
  'describe_math',
  'explain_table',
  'summarize',
  'distil_section',
  'distil_chapter',
  'brief',
  'structure_note',
  'embed',
  'link_concepts',
  'derive',
  'export',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATES = ['queued', 'running', 'done', 'failed', 'skipped'] as const;
export type JobState = (typeof JOB_STATES)[number];

export interface JobPublic {
  id: string;
  kind: JobKind;
  document_id: string | null;
  anchor: string | null;
  skill: string | null;
  skill_version: string | null;
  state: JobState;
  attempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  run_mode: RunMode | null;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * `POST /jobs`. `force` re-runs even when an artifact for the same input exists.
 * `skill` is required for `derive` (else it must match `kind`); `note_id` is required
 * for `structure_note`. Live work is deduplicated per kind, scope, skill and note.
 */
export interface JobCreate {
  kind: JobKind;
  document_id?: string | null;
  anchor?: string | null;
  force?: boolean;
  skill?: string | null;
  note_id?: string | null;
}

/**
 * `202` body of `POST /jobs` and `POST /jobs/{id}/retry`: the queued job, or the live
 * one already covering it. (`DELETE /jobs/{id}` answers the cancelled `JobPublic`.)
 */
export interface JobAccepted {
  job: JobPublic;
  deduplicated: boolean;
}

/** Query of `GET /jobs`. */
export interface JobQuery {
  state?: JobState;
  kind?: JobKind;
  document_id?: string;
  limit?: number;
  offset?: number;
}
