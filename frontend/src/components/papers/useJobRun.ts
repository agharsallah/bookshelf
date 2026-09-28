/**
 * Start one shelf-level job (`POST` → `JobPublic`) and follow it live over `/jobs/stream`,
 * for jobs that belong to no document (refresh suggestions, check the watch list, fetch a
 * candidate's PDF), or for one document's job (`documentId` narrows the stream: QueueJob).
 * `initial` follows a job the page already knows is under way.
 */
import { useState } from 'react';
import type { JobPublic } from '../../lib/api/types/jobs';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { describeJob, type JobProgress } from '../../lib/jobs/progress';
import { problemOf } from '../common/Problem';

export interface JobRun {
  start: () => Promise<void>;
  job: JobPublic | undefined;
  progress: JobProgress | null;
  sending: boolean;
  error: string | null;
  /** Queued or running (or being sent). */
  live: boolean;
  finished: boolean;
}

export function useJobRun(send: () => Promise<JobPublic>, initial: JobPublic | null = null, documentId: string | null = null): JobRun {
  const [jobId, setJobId] = useState<string | null>(initial?.id ?? null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { jobs, queue, track } = useJobStream({ documentId, enabled: jobId !== null, seed: initial ? [initial] : [] });
  const job = jobId ? jobs[jobId] : undefined;
  const progress = job ? describeJob(job, Date.now(), queue) : null;

  const start = async () => {
    setSending(true);
    setError(null);
    try {
      const accepted = await send();
      track(accepted);
      setJobId(accepted.id);
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setSending(false);
    }
  };

  return {
    start,
    job,
    progress,
    sending,
    error,
    live: sending || (progress?.live ?? false),
    finished: progress?.phase === 'done' || progress?.phase === 'skipped',
  };
}
