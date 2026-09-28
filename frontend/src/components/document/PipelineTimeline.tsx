/**
 * Pipeline timeline: the five milestones (registered → linked) with the document's
 * place on them, and its jobs live over `/jobs/stream`. When a job finishes the
 * document is re-read so the milestone moves; a finished parse offers a reload,
 * since the outline below was rendered from the old tree. Each job says where it is —
 * its place in line, a retry backoff, elapsed time — and a banner warns when nothing is
 * running to pick queued jobs up. Jobs in progress and failures stay in view; finished
 * ones fold away under a count.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { DocumentPublic, DocumentStatus } from '../../lib/api/types/documents';
import type { JobPublic, QueueStatus } from '../../lib/api/types/jobs';
import { PIPELINE_STEPS, pipelineProgress, stepState } from '../../lib/documents/pipeline';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { describeJob } from '../../lib/jobs/progress';
import { isFinished, sortedJobs } from '../../lib/jobs/stream';
import { QueueBanner } from '../pipeline/QueueBanner';
import { useNow } from '../pipeline/useNow';
import { jobTitle } from './jobs';
import styles from './PipelineTimeline.module.css';

export interface PipelineTimelineProps {
  documentId: string;
  slug: string;
  initialStatus: DocumentStatus;
  initialJobs: JobPublic[];
}

export function PipelineTimeline({ documentId, slug, initialStatus, initialJobs }: PipelineTimelineProps) {
  const [status, setStatus] = useState<DocumentStatus>(initialStatus);
  const [reparsed, setReparsed] = useState(false);
  const { jobs, queue, status: stream } = useJobStream({ documentId, seed: initialJobs });
  const list = useMemo(() => sortedJobs(jobs), [jobs]);
  const finished = useRef(new Set(initialJobs.filter((j) => isFinished(j.state)).map((j) => j.id)));

  useEffect(() => {
    const newlyDone = list.filter((j) => isFinished(j.state) && !finished.current.has(j.id));
    if (newlyDone.length === 0) return;
    newlyDone.forEach((j) => finished.current.add(j.id));
    if (newlyDone.some((j) => j.kind === 'parse' && j.state === 'done')) setReparsed(true);
    browserApi
      .get<DocumentPublic>(`documents/${slug}`)
      .then((doc) => setStatus(doc.status))
      .catch(() => undefined); // the stream keeps going; the next finish retries
  }, [list, slug]);

  const progress = pipelineProgress(status);
  const live = list.filter((j) => !isFinished(j.state));
  const recent = list.filter((j) => isFinished(j.state)).slice(0, 5);
  const now = useNow(live.length > 0);
  const failed = recent.filter((j) => j.state === 'failed');
  const done = recent.filter((j) => j.state !== 'failed');

  return (
    <section className={styles.timeline} aria-labelledby="pipeline-title">
      <h2 id="pipeline-title" className={styles.heading}>
        Pipeline
      </h2>
      <p className={styles.now} aria-live="polite" data-attention={progress.attention ?? undefined}>
        {progress.label}
        {live.length > 0 ? `, ${live.length} ${live.length === 1 ? 'job' : 'jobs'} in progress` : ''}
      </p>
      <p className={styles.statsLink}>
        <a href={`/pipeline/stats/${slug}`}>Tokens, time and what to improve</a>
      </p>

      <ol className={styles.steps}>
        {PIPELINE_STEPS.map((step, i) => {
          const state = stepState(status, i);
          return (
            <li key={step.key} className={styles.step} data-state={state}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.label}>{step.label}</span>
              <span className="visually-hidden">
                {{ done: ', done', current: ', reached', working: ', in progress', failed: ', failed', review: ', needs review', todo: '' }[state]}
              </span>
            </li>
          );
        })}
      </ol>

      {live.length > 0 ? <QueueBanner queue={queue} /> : null}

      {reparsed ? (
        <p className={styles.reload}>
          Parsing finished.{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Reload to see the new outline
          </button>
        </p>
      ) : null}

      {live.length + recent.length > 0 ? (
        <>
          {live.length + failed.length > 0 ? (
            <JobList jobs={[...live, ...failed]} now={now} queue={queue} label="Jobs in progress and failed" />
          ) : null}
          {done.length > 0 ? (
            <details className={styles.history}>
              <summary>{done.length === 1 ? '1 recent job finished' : `${done.length} recent jobs finished`}</summary>
              <JobList jobs={done} now={now} queue={queue} label="Finished jobs" />
            </details>
          ) : null}
        </>
      ) : (
        <p className={styles.quiet}>No jobs yet.</p>
      )}
      {stream === 'reconnecting' ? <p className={styles.quiet}>Reconnecting to live updates…</p> : null}
    </section>
  );
}

function JobList({ jobs, now, queue, label }: { jobs: JobPublic[]; now: number; queue: QueueStatus | null; label: string }) {
  return (
    <ul className={styles.jobs} aria-label={label}>
      {jobs.map((job) => {
        const progress = describeJob(job, now, queue);
        return (
          <li key={job.id} className={styles.job} data-state={job.state} data-phase={progress.phase}>
            <span className={styles.jobKind}>
              {jobTitle(job)}
              {job.anchor ? <span className={styles.jobAnchor}> {job.anchor}</span> : null}
            </span>
            <span className={styles.jobState}>{progress.text}</span>
            {job.state === 'failed' && job.error ? (
              <span className={styles.jobError} title={job.error}>
                {job.error}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default PipelineTimeline;
