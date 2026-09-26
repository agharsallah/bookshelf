/**
 * Pure state for `GET /jobs/stream` (backend/app/api/routes/job_events.py).
 *
 * The server emits `event: job` with a `JobPublic` as data whenever a job's state,
 * attempts, finish time or place in line change (the first poll is a snapshot of live
 * and recent jobs), `event: queue` with a `QueueStatus` whenever the queue's health
 * changes (who is polling, what nobody runs), and `event: end {reason}` when the stream
 * hits `max_seconds` or the server shuts down. ./connection.ts reconnects, so the reducer must tolerate replays: an
 * event only replaces what we hold when it is not older than it.
 */
import type { JobPublic, QueueStatus } from '../api/types/jobs';
import { parseData } from '../sse';

export type JobStreamEvent =
  | { type: 'job'; job: JobPublic }
  | { type: 'queue'; queue: QueueStatus }
  | { type: 'open' }
  | { type: 'error' }
  | { type: 'end' };

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface JobStreamState {
  status: StreamStatus;
  /** Latest known version of each job, by id. */
  jobs: Readonly<Record<string, JobPublic>>;
  /** The latest queue health, or null before the first `queue` event. */
  queue: QueueStatus | null;
}

export const initialJobStreamState: JobStreamState = { status: 'connecting', jobs: {}, queue: null };

const STATE_RANK: Record<JobPublic['state'], number> = {
  queued: 0,
  running: 1,
  done: 2,
  failed: 2,
  skipped: 2,
};

/**
 * True when `next` describes the same job at a later (or equal) point in its life.
 * `run_after` only moves forward — a failed attempt backs off, a stopping worker hands
 * its job back — and each time the job returns to `queued` from `running`, so a later
 * `run_after` wins first. Otherwise attempts dominate state (a claim adds one).
 */
export function isNewer(next: JobPublic, current: JobPublic | undefined): boolean {
  if (!current) return true;
  const nextAfter = Date.parse(next.run_after ?? '');
  const currentAfter = Date.parse(current.run_after ?? '');
  if (!Number.isNaN(nextAfter) && !Number.isNaN(currentAfter) && nextAfter !== currentAfter) return nextAfter > currentAfter;
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
    case 'queue':
      return { ...state, queue: event.queue };
    case 'job': {
      const current = state.jobs[event.job.id];
      if (!isNewer(event.job, current)) return state;
      return { ...state, jobs: { ...state.jobs, [event.job.id]: event.job } };
    }
  }
}

/** Parse one SSE `data` payload; `null` for anything that is not a job. */
export function parseJobEvent(data: string): JobPublic | null {
  // Malformed frames are dropped; the next poll (or reconnect snapshot) re-sends the job.
  const value = parseData<Partial<JobPublic>>(data);
  if (value && typeof value.id === 'string' && typeof value.state === 'string' && typeof value.kind === 'string') {
    return value as JobPublic;
  }
  return null;
}

/** Parse one `queue` payload; `null` for anything that is not a queue status. */
export function parseQueueEvent(data: string): QueueStatus | null {
  const value = parseData<Partial<QueueStatus>>(data);
  if (value && Array.isArray(value.workers) && Array.isArray(value.unclaimed_kinds)) return value as QueueStatus;
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
