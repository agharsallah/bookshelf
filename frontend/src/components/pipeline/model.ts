/**
 * Pipeline view model (§7): per-document progress through the stages, tallies by state
 * and kind, elapsed times, and what a retry re-enqueues. Pure; the view only draws it.
 */
import type { JobKind, JobPublic, JobState } from '../../lib/api/types/jobs';

export interface Stage {
  key: string;
  label: string;
  kinds: readonly JobKind[];
  /** Document statuses (§7 state machine) meaning this stage is finished. */
  doneAt: readonly string[];
}

const AFTER_BRIEF = ['distilled', 'indexed', 'linked', 'deriving'];

export const STAGES: readonly Stage[] = [
  { key: 'parse', label: 'Parse', kinds: ['parse'], doneAt: ['parsed', 'needs_review', 'enriching', 'distilling', ...AFTER_BRIEF] },
  {
    key: 'enrich',
    label: 'Enrich',
    kinds: ['describe_figure', 'explain_code', 'describe_math', 'explain_table', 'summarize'],
    doneAt: ['distilling', ...AFTER_BRIEF],
  },
  { key: 'distil', label: 'Distil', kinds: ['distil_section', 'distil_chapter'], doneAt: AFTER_BRIEF },
  { key: 'brief', label: 'Brief', kinds: ['brief'], doneAt: AFTER_BRIEF },
  { key: 'index', label: 'Index', kinds: ['embed'], doneAt: ['indexed', 'linked', 'deriving'] },
  { key: 'link', label: 'Link', kinds: ['link_concepts'], doneAt: ['linked', 'deriving'] },
  { key: 'derive', label: 'Derive', kinds: ['derive'], doneAt: [] },
];

export type StageState = 'waiting' | 'active' | 'done' | 'failed';

export type StateCounts = Record<JobState, number>;

export interface StageProgress {
  stage: Stage;
  state: StageState;
  counts: StateCounts;
}

const zero = (): StateCounts => ({ queued: 0, running: 0, done: 0, failed: 0, skipped: 0 });

export function countStates(jobs: readonly JobPublic[]): StateCounts {
  const counts = zero();
  for (const job of jobs) counts[job.state] += 1;
  return counts;
}

export function countKinds(jobs: readonly JobPublic[]): Partial<Record<JobKind, number>> {
  const counts: Partial<Record<JobKind, number>> = {};
  for (const job of jobs) counts[job.kind] = (counts[job.kind] ?? 0) + 1;
  return counts;
}

/**
 * One document's stages. Live work makes a stage active; a failure with nothing live
 * marks it failed; the document status (or all jobs finished) marks it done.
 */
export function stageProgress(status: string, jobs: readonly JobPublic[]): StageProgress[] {
  return STAGES.map((stage) => {
    const counts = countStates(jobs.filter((j) => stage.kinds.includes(j.kind)));
    const live = counts.queued + counts.running;
    const finished = counts.done + counts.skipped;
    let state: StageState = 'waiting';
    if (live > 0) state = 'active';
    else if (stage.key === 'parse' && status === 'parse_failed') state = 'failed';
    else if (counts.failed > 0) state = 'failed';
    else if (stage.doneAt.includes(status) || finished > 0) state = 'done';
    return { stage, state, counts };
  });
}

/** Milliseconds a job has run: live for a running job, recorded for a finished one. */
export function elapsedMs(job: JobPublic, now: number): number | null {
  if (job.state === 'running' && job.started_at) return Math.max(0, now - Date.parse(job.started_at));
  if (job.duration_ms !== null) return job.duration_ms;
  if (job.started_at && job.finished_at) return Date.parse(job.finished_at) - Date.parse(job.started_at);
  return null;
}

/** `850 ms`, `12 s`, `3 min 04 s`, `1 h 02 min`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** §14 run ceiling: the worker fails the job with this message and pauses the document. */
export function isRunCeiling(job: Pick<JobPublic, 'error'>): boolean {
  return job.error?.startsWith('run ceiling reached') ?? false;
}

export interface JobFilters {
  state?: JobState | '';
  kind?: JobKind | '';
  document?: string;
}

export function filterJobs(jobs: readonly JobPublic[], filters: JobFilters): JobPublic[] {
  return jobs.filter(
    (j) =>
      (!filters.state || j.state === filters.state) &&
      (!filters.kind || j.kind === filters.kind) &&
      (!filters.document || j.document_id === filters.document),
  );
}

export interface RetrySpec {
  kind: JobKind;
  document_id: string | null;
  anchor: string | null;
}

/**
 * What a retry enqueues: same kind and scope. `derive` needs its skill name and
 * `structure_note` its note id, which `POST /jobs` cannot carry, so those are not retryable.
 */
export function retrySpec(job: JobPublic): RetrySpec | null {
  if (job.kind === 'derive' || job.kind === 'structure_note') return null;
  return { kind: job.kind, document_id: job.document_id, anchor: job.anchor };
}

export const KIND_LABELS: Record<JobKind, string> = {
  parse: 'Parse',
  describe_figure: 'Describe figure',
  explain_code: 'Explain code',
  describe_math: 'Describe formula',
  explain_table: 'Explain table',
  summarize: 'Summarize',
  distil_section: 'Distil section',
  distil_chapter: 'Distil chapter',
  brief: 'Write brief',
  structure_note: 'Structure note',
  embed: 'Embed',
  link_concepts: 'Link concepts',
  derive: 'Derive',
  export: 'Export',
};
