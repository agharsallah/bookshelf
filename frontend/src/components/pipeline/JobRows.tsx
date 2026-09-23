/** Running, failed and recent jobs: kind, document, scope, attempts, time, and errors. */
import { useState } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { ApiClient } from '../../lib/api/client';
import type { JobAccepted, JobPublic } from '../../lib/api/types/jobs';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { relativeTime } from '../review/labels';
import { elapsedMs, formatDuration, isRunCeiling, KIND_LABELS, retrySpec } from './model';
import styles from './JobRows.module.css';

export interface JobRowProps {
  job: JobPublic;
  title: string;
  now: number;
}

function Scope({ job, title }: { job: JobPublic; title: string }) {
  return (
    <span className={styles.scope}>
      <span className={styles.jobDoc}>{title}</span>
      {job.anchor ? (
        <span className={styles.jobAnchor} title={job.anchor}>
          {anchorLabel(job.anchor)}
        </span>
      ) : null}
      {job.skill ? <span className={styles.jobSkill}>{job.skill_version ? `${job.skill}@${job.skill_version}` : job.skill}</span> : null}
    </span>
  );
}

export function RunningRow({ job, title, now }: JobRowProps) {
  const ms = elapsedMs(job, now);
  return (
    <li className={styles.job} data-state={job.state}>
      <span className={styles.jobKind}>{KIND_LABELS[job.kind]}</span>
      <Scope job={job} title={title} />
      <span className={styles.jobTime}>
        {job.state === 'running' ? (ms !== null ? formatDuration(ms) : 'starting') : `queued ${relativeTime(job.created_at, now)}`}
        {job.attempts > 1 ? <span className={styles.attempts}> attempt {job.attempts}</span> : null}
      </span>
    </li>
  );
}

type Retry = { state: 'idle' } | { state: 'sending' } | { state: 'sent'; deduplicated: boolean } | { state: 'error'; problem: ProblemInfo };

export function FailedRow({ job, title, now, api, onQueued }: JobRowProps & { api: ApiClient; onQueued: (job: JobPublic) => void }) {
  const [retry, setRetry] = useState<Retry>({ state: 'idle' });
  const spec = retrySpec(job);
  const ceiling = isRunCeiling(job);

  const send = async () => {
    if (!spec) return;
    setRetry({ state: 'sending' });
    try {
      const accepted = await api.post<JobAccepted>('jobs', spec);
      onQueued(accepted.job);
      setRetry({ state: 'sent', deduplicated: accepted.deduplicated });
    } catch (error) {
      setRetry({ state: 'error', problem: problemOf(error) });
    }
  };

  return (
    <li className={styles.job} data-state="failed" data-ceiling={ceiling || undefined}>
      <span className={styles.jobKind}>{KIND_LABELS[job.kind]}</span>
      <Scope job={job} title={title} />
      <span className={styles.jobTime}>
        {job.finished_at ? relativeTime(job.finished_at, now) : null}
        <span className={styles.attempts}> after {job.attempts} attempt{job.attempts === 1 ? '' : 's'}</span>
      </span>
      {job.error ? (
        <details className={styles.error}>
          <summary>{job.error.split('\n')[0]?.slice(0, 160)}</summary>
          <pre>{job.error}</pre>
        </details>
      ) : null}
      <span className={styles.retry}>
        {spec ? (
          <button type="button" onClick={() => void send()} disabled={retry.state === 'sending' || retry.state === 'sent'}>
            {retry.state === 'sending' ? 'Retrying…' : 'Retry'}
          </button>
        ) : (
          <span className={styles.muted}>Retry from the CLI (needs the skill name)</span>
        )}
        <span aria-live="polite" className={styles.muted}>
          {retry.state === 'sent' ? (retry.deduplicated ? 'Already queued.' : 'Queued again.') : null}
        </span>
      </span>
      {retry.state === 'error' ? <Problem title="The retry was not queued." problem={retry.problem} inline /> : null}
    </li>
  );
}

export function RecentRow({ job, title, now }: JobRowProps) {
  const ms = elapsedMs(job, now);
  return (
    <tr data-state={job.state}>
      <td>{KIND_LABELS[job.kind]}</td>
      <td>
        <Scope job={job} title={title} />
      </td>
      <td className={styles.stateCell}>{job.state}</td>
      <td className={styles.num}>{ms !== null ? formatDuration(ms) : '—'}</td>
      <td className={styles.num}>{relativeTime(job.finished_at ?? job.created_at, now)}</td>
    </tr>
  );
}
