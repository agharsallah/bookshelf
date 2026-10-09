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
  'narrate',
  'grade_recall',
  // Papers: stage skills, then Python jobs (docs/PAPERS.md §2)
  'distil_paper_section',
  'dissect_paper',
  'link_paper_concepts',
  'paper_structure',
  'paper_enrich',
  'paper_candidates',
  'paper_watch',
  'paper_fetch',
  'relate_claims',
  'recommend_next',
  'synthesize_papers',
  // Builds (docs/BUILDS.md): the plan skill, then the agent run
  'build_plan',
  'build_run',
  // Pills (docs/PILLS.md §4)
  'harvest_pills',
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
  /** What the job was asked for (`params`, `voices`, `artifact_id`, `force`…). */
  payload?: Record<string, unknown>;
  state: JobState;
  attempts: number;
  error: string | null;
  result: Record<string, unknown> | null;
  run_mode: RunMode | null;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** When a queued job may start: now for fresh work, later while a retry backs off. */
  run_after?: string;
  /** A queued job's place in line (1 = next to start); null unless queued. */
  queue_position?: number | null;
  /** Sent to the front by a person (`POST /jobs/{id}/run-now`): starts even while paused. */
  run_now?: boolean;
}

/** One CLI call a job made (`GET /jobs/{id}/runs`): its run log, failures included. */
export interface ModelRunPublic {
  id: string;
  attempt: number;
  call: number;
  skill: string | null;
  skill_version: string | null;
  tier: string | null;
  model: string | null;
  ok: boolean;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number;
  api_ms: number | null;
  turns: number | null;
  prompt_chars: number;
  reply_chars: number | null;
  images: number;
  created_at: string;
}

/** One run-log line (`GET /jobs/{id}/log`): `type` says which fields it carries. */
export interface RunLogEvent {
  at: string;
  attempt: number;
  type: string;
  [field: string]: unknown;
}

/** A page of a job's run log, and the offset to ask from next. */
export interface RunLogPage {
  events: RunLogEvent[];
  next: number;
}

/** A worker process polling the queue (`GET /jobs/queue`). */
export interface WorkerPublic {
  name: string;
  kinds: JobKind[];
  concurrency: number;
  running: number;
  started_at: string;
  seen_at: string;
}

/**
 * Queue health (`GET /jobs/queue`, and the `queue` event of `/jobs/stream`).
 * `unclaimed_kinds`: kinds with queued work that no live worker runs, so it will wait
 * until one starts. `paused`: no worker starts a job (running ones finish).
 * `paused_reason`: why the queue paused itself (the model's usage limit); null when a
 * person paused it.
 * `max_running`: jobs running at once across every worker (null: every slot).
 * `slots`: job slots across live workers that run token-spending work. Embedding and
 * narration are neither capped nor counted.
 */
export interface QueueStatus {
  workers: WorkerPublic[];
  queued: number;
  running: number;
  unclaimed_kinds: JobKind[];
  paused: boolean;
  paused_reason?: string | null;
  max_running: number | null;
  slots: number;
  /** Each steered kind's mode; kinds left out run as usual. */
  kinds?: Partial<Record<JobKind, KindMode>>;
  /** Books whose jobs go before other queued work. */
  first_documents?: string[];
  /** Kinds that may be skipped: their stage moves on without them. */
  skippable_kinds?: JobKind[];
  /** Queued jobs per kind, all of them (the page loads only the latest jobs). */
  queued_kinds?: Partial<Record<JobKind, number>>;
}

/**
 * How a kind is steered in the queue: `first` goes before other queued work, `hold` waits
 * (its book's later stages wait too), `skip` is dropped as it comes up, like a cancel.
 */
export const KIND_MODES = ['first', 'hold', 'skip'] as const;
export type KindMode = (typeof KIND_MODES)[number];

/**
 * `PATCH /jobs/queue`: fields left out keep their value; `max_running: null` lifts the cap.
 * `kinds` merges (`null` runs a kind as usual again); `first_documents` replaces.
 */
export interface QueueControlsUpdate {
  paused?: boolean;
  max_running?: number | null;
  kinds?: Partial<Record<JobKind, KindMode | null>>;
  first_documents?: string[];
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
  /** Run parameters of a skill that declares them (`SkillPublic.params`). */
  params?: Record<string, string | number>;
  /** Narrated skills and `narrate`: a voice id per speaker, speaker 1 first. */
  voices?: string[];
  /** `narrate`: the `audio_summary` script to voice; without it, the chapter at `anchor` is read aloud. */
  artifact_id?: string;
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
