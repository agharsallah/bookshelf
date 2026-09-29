/**
 * Where a job is in its life, in words a reader can act on. Pure; used by every surface
 * that shows a job (study buttons, the pipeline timeline, the pipeline page).
 *
 * `queued` alone hid four different situations; `describeJob` tells them apart:
 * waiting its turn (and its place in line), backing off before a retry, held by a paused
 * queue (`QueueStatus.paused`), and waiting for a worker that is not running at all
 * (`QueueStatus.unclaimed_kinds`) — the last two need the user to do something.
 */
import type { JobPublic, QueueStatus } from '../api/types/jobs';

export type JobPhase = 'waiting' | 'paused' | 'stalled' | 'backoff' | 'running' | 'done' | 'skipped' | 'failed';

export interface JobProgress {
  phase: JobPhase;
  /** Short status for the job ("3rd in line", "Running · 1 min 04 s"). */
  text: string;
  /** Whether the job may still change (queued or running). */
  live: boolean;
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

export function elapsedMs(job: JobPublic, now: number): number | null {
  if (job.state === 'running' && job.started_at) return Math.max(0, now - Date.parse(job.started_at));
  if (job.duration_ms !== null) return job.duration_ms;
  if (job.started_at && job.finished_at) return Date.parse(job.finished_at) - Date.parse(job.started_at);
  return null;
}

/** "next", "2nd in line", "3rd in line", "11th in line". */
export function placeInLine(position: number): string {
  if (position <= 1) return 'next in line';
  const tens = position % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[position % 10] ?? 'th');
  return `${position}${suffix} in line`;
}

/** Whether no live worker runs this job's kind, so it will not start on its own. */
export function isStalled(job: Pick<JobPublic, 'state' | 'kind'>, queue: QueueStatus | null): boolean {
  return job.state === 'queued' && queue !== null && queue.unclaimed_kinds.includes(job.kind);
}

export function describeJob(job: JobPublic, now: number, queue: QueueStatus | null = null): JobProgress {
  switch (job.state) {
    case 'queued': {
      if (isStalled(job, queue))
        return {
          phase: 'stalled',
          text: 'Waiting: no worker is running',
          live: true,
        };
      const place = job.queue_position ? `, ${placeInLine(job.queue_position)}` : '';
      if (queue?.paused) return { phase: 'paused', text: `Paused${place}`, live: true };
      const after = Date.parse(job.run_after ?? '');
      if (!Number.isNaN(after) && after > now) {
        return {
          phase: 'backoff',
          text: `Retrying in ${formatDuration(after - now)}`,
          live: true,
        };
      }
      return { phase: 'waiting', text: `Queued${place}`, live: true };
    }
    case 'running': {
      const ms = elapsedMs(job, now);
      const attempt = job.attempts > 1 ? ` · attempt ${job.attempts}` : '';
      return {
        phase: 'running',
        text: `Running${ms !== null ? ` · ${formatDuration(ms)}` : ''}${attempt}`,
        live: true,
      };
    }
    case 'done':
      return { phase: 'done', text: 'Done', live: false };
    case 'skipped':
      return {
        phase: 'skipped',
        text: job.error ? 'Cancelled' : 'Up to date',
        live: false,
      };
    case 'failed':
      return { phase: 'failed', text: 'Failed', live: false };
  }
}

/** The artifact a finished job made or found (`result.artifact_id`), if any. */
export function artifactOf(job: JobPublic): string | null {
  const id = job.result?.artifact_id;
  return typeof id === 'string' ? id : null;
}

/** The most recent job that `matches`, by creation time. */
export function latestJob(jobs: Readonly<Record<string, JobPublic>>, matches: (job: JobPublic) => boolean): JobPublic | undefined {
  let latest: JobPublic | undefined;
  for (const job of Object.values(jobs)) {
    if (matches(job) && (!latest || job.created_at > latest.created_at)) latest = job;
  }
  return latest;
}
