/**
 * Pure state for `GET /jobs/stream` (backend/app/api/routes/job_events.py).
 *
 * The server emits `event: job` with a `Job` as data whenever a job's state,
 * attempts or finish time change (the first poll is a snapshot of live and recent
 * jobs), and `event: end` when the stream hits `max_seconds`. `EventSource`
 * reconnects by itself, so the reducer must tolerate replays: an event only
 * replaces what we hold when it is not older than it.
 */
import type { JobPublic } from '../api/types/jobs';

export type JobStreamEvent =
  | { type: 'job'; job: JobPublic }
  | { type: 'open' }
  | { type: 'error' }
  | { type: 'end' };

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface JobStreamState {
  status: StreamStatus;
  /** Latest known version of each job, by id. */
  jobs: Readonly<Record<string, JobPublic>>;
}

export const initialJobStreamState: JobStreamState = { status: 'connecting', jobs: {} };

const STATE_RANK: Record<JobPublic['state'], number> = {
  queued: 0,
  running: 1,
  done: 2,
  failed: 2,
  skipped: 2,
};

/**
 * True when `next` describes the same job at a later (or equal) point in its life.
 * Retries go back to `queued` with more attempts, so attempts dominate state.
 */
export function isNewer(next: JobPublic, current: JobPublic | undefined): boolean {
  if (!current) return true;
  if (next.attempts !== current.attempts) return next.attempts > current.attempts;
  return STATE_RANK[next.state] >= STATE_RANK[current.state];
}

export function jobStreamReducer(state: JobStreamState, event: JobStreamEvent): JobStreamState {
  switch (event.type) {
    case 'open':
      return { ...state, status: 'live' };
    case 'error':
      return { ...state, status: state.status === 'closed' ? 'closed' : 'reconnecting' };
    case 'end':
      return { ...state, status: 'reconnecting' };
    case 'job': {
      const current = state.jobs[event.job.id];
      if (!isNewer(event.job, current)) return state;
      return { ...state, jobs: { ...state.jobs, [event.job.id]: event.job } };
    }
  }
}

/** Parse one SSE `data` payload; `null` for anything that is not a job. */
export function parseJobEvent(data: string): JobPublic | null {
  try {
    const value = JSON.parse(data) as Partial<JobPublic> | null;
    if (value && typeof value.id === 'string' && typeof value.state === 'string' && typeof value.kind === 'string') {
      return value as JobPublic;
    }
  } catch {
    // Malformed frames are dropped; the next poll re-sends the job.
  }
  return null;
}

/** Jobs newest first, optionally narrowed. */
export function sortedJobs(
  jobs: Readonly<Record<string, JobPublic>>,
  keep: (job: JobPublic) => boolean = () => true,
): JobPublic[] {
  return Object.values(jobs)
    .filter(keep)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** A job that will not change any more. */
export function isFinished(state: JobPublic['state'] | undefined): boolean {
  return state === 'done' || state === 'failed' || state === 'skipped';
}
