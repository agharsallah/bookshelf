/**
 * Pipeline timeline: the five milestones (registered → linked) with the document's
 * place on them, and its jobs live over `/jobs/stream`. When a job finishes the
 * document is re-read so the milestone moves; a finished parse offers a reload,
 * since the outline below was rendered from the old tree.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { DocumentPublic, DocumentStatus } from '../../lib/api/types/documents';
import type { JobPublic } from '../../lib/api/types/jobs';
import { PIPELINE_STEPS, pipelineProgress, stepState } from '../../lib/documents/pipeline';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { isFinished, sortedJobs } from '../../lib/jobs/stream';
import { jobName } from './jobs';
import styles from './PipelineTimeline.module.css';

export interface PipelineTimelineProps {
  documentId: string;
  slug: string;
  initialStatus: DocumentStatus;
  initialJobs: JobPublic[];
}

const STATE_WORDS: Record<JobPublic['state'], string> = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped, nothing changed',
};

export function PipelineTimeline({ documentId, slug, initialStatus, initialJobs }: PipelineTimelineProps) {
  const [status, setStatus] = useState<DocumentStatus>(initialStatus);
  const [reparsed, setReparsed] = useState(false);
  const { jobs, status: stream } = useJobStream({ documentId, seed: initialJobs });
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

  return (
    <section className={styles.timeline} aria-labelledby="pipeline-title">
      <h2 id="pipeline-title" className={styles.heading}>
        Pipeline
      </h2>
      <p className={styles.now} aria-live="polite" data-attention={progress.attention ?? undefined}>
        {progress.label}
        {live.length > 0 ? `, ${live.length} ${live.length === 1 ? 'job' : 'jobs'} in progress` : ''}
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

      {reparsed ? (
        <p className={styles.reload}>
          Parsing finished.{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Reload to see the new outline
          </button>
        </p>
      ) : null}

      {live.length + recent.length > 0 ? (
        <ul className={styles.jobs} aria-label="Recent jobs">
          {[...live, ...recent].map((job) => (
            <li key={job.id} className={styles.job} data-state={job.state}>
              <span className={styles.jobKind}>
                {jobName(job.kind)}
                {job.anchor ? <span className={styles.jobAnchor}> {job.anchor}</span> : null}
              </span>
              <span className={styles.jobState}>{STATE_WORDS[job.state]}</span>
              {job.state === 'failed' && job.error ? <span className={styles.jobError}>{job.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.quiet}>No jobs yet.</p>
      )}
      {stream === 'reconnecting' ? <p className={styles.quiet}>Reconnecting to live updates…</p> : null}
    </section>
  );
}

export default PipelineTimeline;
