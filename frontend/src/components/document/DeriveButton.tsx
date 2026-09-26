/**
 * One study-material action (quiz, FAQ, quotes, …) for a chapter or the whole book, with
 * the state of its latest job beside it, live from `/jobs/stream`.
 *
 * While the job is queued or running the button is disabled, so a second click cannot
 * queue it again, and the status says what it is waiting for: its place in line, a retry
 * backoff, or a worker that is not running at all. A queued job can be cancelled. Once it
 * finishes the status links to the artifact; a failed one shows why and can be tried again.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { JobPublic, QueueStatus } from '../../lib/api/types/jobs';
import type { SkillPublic } from '../../lib/api/types/skills';
import { cancelJob } from '../../lib/jobs/api';
import { artifactOf, describeJob } from '../../lib/jobs/progress';
import { problemOf } from '../common/Problem';
import { deriveLabel, enqueue } from './jobs';
import { toast } from './toast';
import styles from './DeriveButton.module.css';

export interface DeriveButtonProps {
  skill: SkillPublic;
  documentId: string;
  /** The chapter, or null for the whole book. */
  anchor: string | null;
  /** The latest job of this skill on this scope, if any. */
  job: JobPublic | undefined;
  queue: QueueStatus | null;
  now: number;
  /** An artifact this skill already made for this scope (shown until a job says more). */
  madeId?: string | null;
  /** Why the action cannot run yet, if it cannot. */
  blocked?: string | null;
  /** A job learnt from a `POST` or `DELETE` response, for the shared stream state. */
  onJob: (job: JobPublic) => void;
  api?: Pick<ApiClient, 'post' | 'delete'>;
}

export function DeriveButton({ skill, documentId, anchor, job, queue, now, madeId = null, blocked = null, onJob, api = browserApi }: DeriveButtonProps) {
  const [sending, setSending] = useState(false);
  const label = deriveLabel(skill);
  const progress = job ? describeJob(job, now, queue) : null;
  const live = progress?.live ?? false;
  const made = (job && artifactOf(job)) ?? madeId;

  const start = async () => {
    setSending(true);
    const accepted = await enqueue(api, { kind: 'derive', documentId, anchor, skill }, { quiet: true });
    if (accepted) onJob(accepted.job);
    setSending(false);
  };

  const cancel = async (id: string) => {
    try {
      onJob(await cancelJob(api, id));
    } catch (error) {
      toast(`Could not cancel: ${problemOf(error).message}`, 'bad');
    }
  };

  return (
    <span className={styles.item} data-phase={progress?.phase ?? 'idle'}>
      <button
        type="button"
        className={styles.button}
        disabled={sending || live || blocked !== null}
        aria-busy={sending || live || undefined}
        title={blocked ?? skill.description}
        onClick={() => void start()}
      >
        {live || sending ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {progress?.phase === 'failed' ? `${label} again` : label}
      </button>
      <span className={styles.status}>
        <span aria-live="polite">{sending ? 'Queueing…' : progress ? phaseWords(progress.phase, progress.text) : null}</span>
        {progress?.phase === 'running' ? (
          <span className={styles.detail} aria-hidden="true">
            {progress.text.replace(/^Running/, '')}
          </span>
        ) : null}
        {job && job.state === 'queued' ? (
          <button type="button" className={styles.link} onClick={() => void cancel(job.id)}>
            Cancel
          </button>
        ) : null}
        {!live && made ? (
          <a className={styles.link} href={`/review/${made}`}>
            View
          </a>
        ) : null}
        {progress?.phase === 'failed' && job?.error ? (
          <span className={styles.error} title={job.error}>
            {job.error.split('\n')[0]?.slice(0, 120)}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** The part of the status worth announcing: the phase, not a ticking timer. */
function phaseWords(phase: string, text: string): string {
  return phase === 'running' ? 'Running' : text;
}

export default DeriveButton;
