/**
 * Running, failed and recent jobs: kind, document, scope, attempts, time, and errors. A
 * queued job says what it waits for: its place in line, a retry, or a missing worker.
 * A queued job can be sent to the front (`POST /jobs/{id}/run-now`: the next free slot
 * under the cap, even while paused) or cancelled (`DELETE /jobs/{id}`), a failed one retried
 * (`POST /jobs/{id}/retry`: same kind, scope, skill, note and payload). Every row carries
 * the job's log (./JobLog.tsx), closed until clicked. A queued job whose kind is on hold or
 * skipped in the queue is greyed, with a link to its kind in Settings.
 */
import { useState } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { ApiClient } from '../../lib/api/client';
import type { JobPublic, QueueStatus } from '../../lib/api/types/jobs';
import { cancelJob, retryJob, runJobNow } from '../../lib/jobs/api';
import { describeJob } from '../../lib/jobs/progress';
import { jobTitle } from '../document/jobs';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { relativeTime } from '../review/labels';
import { JobLog } from './JobLog';
import { kindSettingsHref } from './steering';
import { elapsedMs, formatDuration, KIND_LABELS } from './model';
import styles from './JobRows.module.css';

const kindLabel = (kind: JobPublic['kind']) => KIND_LABELS[kind];

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

type Control = { state: 'idle' } | { state: 'sending' } | { state: 'sent'; deduplicated: boolean } | { state: 'error'; problem: ProblemInfo };

export type JobApi = Pick<ApiClient, 'get' | 'post' | 'delete'>;

type JobControlProps = JobRowProps & { api: JobApi; onChanged: (job: JobPublic) => void };

type QueuedAction = 'cancel' | 'runNow';

const ACTIONS = {
  cancel: { call: cancelJob, label: 'Cancel', sending: 'Cancelling…', failed: 'The job was not cancelled.' },
  runNow: { call: runJobNow, label: 'Run now', sending: 'Sending…', failed: 'The job was not moved to the front.' },
} satisfies Record<QueuedAction, { call: typeof cancelJob; label: string; sending: string; failed: string }>;

export function RunningRow({ job, title, now, api, onChanged, queue = null }: JobControlProps & { queue?: QueueStatus | null }) {
  const [control, setControl] = useState<{ action: QueuedAction; state: Control } | null>(null);
  const ms = elapsedMs(job, now);
  const sending = control?.state.state === 'sending';
  const name = `${jobTitle(job, kindLabel)} for ${title}`;
  // A kind on hold or skipped in the queue: greyed, with where to change it.
  const steered = job.state === 'queued' && !job.run_now ? queue?.kinds?.[job.kind] : undefined;
  const turnedOff = steered === 'hold' || steered === 'skip' ? steered : undefined;

  const send = async (action: QueuedAction) => {
    setControl({ action, state: { state: 'sending' } });
    try {
      onChanged(await ACTIONS[action].call(api, job.id));
      setControl(null);
    } catch (error) {
      setControl({ action, state: { state: 'error', problem: problemOf(error) } });
    }
  };

  const button = (action: QueuedAction) => (
    <button type="button" className="btn" onClick={() => void send(action)} disabled={sending} aria-label={`${ACTIONS[action].label} ${name}`}>
      {sending && control?.action === action ? ACTIONS[action].sending : ACTIONS[action].label}
    </button>
  );

  return (
    <li className={styles.job} data-state={job.state} data-steered={turnedOff}>
      <span className={styles.jobKind}>{jobTitle(job, kindLabel)}</span>
      <Scope job={job} title={title} />
      <span className={styles.jobTime}>
        {job.state === 'running' ? (ms !== null ? formatDuration(ms) : 'starting') : `${describeJob(job, now, queue).text} · ${relativeTime(job.created_at, now)}`}
        {job.attempts > 1 ? <span className={styles.attempts}> attempt {job.attempts}</span> : null}
      </span>
      {job.state === 'queued' ? (
        <span className={styles.retry}>
          {job.run_now ? null : button('runNow')}
          {button('cancel')}
          {turnedOff ? (
            <a className={styles.steerLink} href={kindSettingsHref(job.kind)}>
              {kindLabel(job.kind)} is {turnedOff === 'hold' ? 'on hold' : 'skipped'}: change it in Settings
            </a>
          ) : null}
        </span>
      ) : null}
      {control?.state.state === 'error' ? <Problem title={ACTIONS[control.action].failed} problem={control.state.problem} inline /> : null}
      <JobLog job={job} api={api} />
    </li>
  );
}

export interface FailedRowProps extends JobControlProps {
  paused?: boolean;
  /** Already queued again from elsewhere (its group's "Retry all"). */
  retried?: boolean;
  /** One line, without the error: its group already says it (./FailureGroups.tsx). */
  compact?: boolean;
}

export function FailedRow({ job, title, now, api, onChanged, paused = false, retried = false, compact = false }: FailedRowProps) {
  const [own, setRetry] = useState<Control>({ state: 'idle' });
  const retry: Control = retried && own.state === 'idle' ? { state: 'sent', deduplicated: false } : own;

  const send = async () => {
    setRetry({ state: 'sending' });
    try {
      const accepted = await retryJob(api, job.id);
      onChanged(accepted.job);
      setRetry({ state: 'sent', deduplicated: accepted.deduplicated });
    } catch (error) {
      setRetry({ state: 'error', problem: problemOf(error) });
    }
  };

  return (
    <li className={styles.job} data-state="failed" data-ceiling={paused || undefined} data-compact={compact || undefined}>
      <span className={styles.jobKind}>{jobTitle(job, kindLabel)}</span>
      <Scope job={job} title={title} />
      <span className={styles.jobTime}>
        {job.finished_at ? relativeTime(job.finished_at, now) : null}
        <span className={styles.attempts}> after {job.attempts} attempt{job.attempts === 1 ? '' : 's'}</span>
      </span>
      {job.error && !compact ? (
        <details className={styles.error}>
          <summary>{job.error.split('\n')[0]?.slice(0, 160)}</summary>
          <pre>{job.error}</pre>
        </details>
      ) : null}
      <span className={styles.retry}>
        {paused ? (
          <span className={styles.muted}>Its document is paused; resuming requeues it.</span>
        ) : (
          <button type="button" className="btn" onClick={() => void send()} disabled={retry.state === 'sending' || retry.state === 'sent'}>
            {retry.state === 'sending' ? 'Retrying…' : 'Retry'}
          </button>
        )}
        <span aria-live="polite" className={styles.muted}>
          {retry.state === 'sent' ? (retry.deduplicated ? 'Already queued.' : 'Queued again.') : null}
        </span>
      </span>
      {retry.state === 'error' ? <Problem title="The retry was not queued." problem={retry.problem} inline /> : null}
      <JobLog job={job} api={api} />
    </li>
  );
}

export function RecentRow({ job, title, now, api }: JobRowProps & { api: Pick<ApiClient, 'get'> }) {
  const ms = elapsedMs(job, now);
  return (
    <li className={styles.job} data-state={job.state}>
      <span className={styles.jobKind}>{jobTitle(job, kindLabel)}</span>
      <Scope job={job} title={title} />
      <span className={styles.jobTime}>
        <span className={styles.stateCell}>{job.state === 'skipped' ? (job.error ?? 'skipped') : 'done'}</span>
        {ms !== null ? ` · took ${formatDuration(ms)}` : ''} · {relativeTime(job.finished_at ?? job.created_at, now)}
      </span>
      <JobLog job={job} api={api} />
    </li>
  );
}
