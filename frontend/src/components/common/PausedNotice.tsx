/**
 * A document the run ceiling paused (§14): why, how many runs it used, and a Resume
 * that lifts the pause and requeues what the ceiling stopped. Shown on the document
 * page and on the pipeline, from the document's own `paused` state.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { PausedState } from '../../lib/api/types/documents';
import type { JobPublic } from '../../lib/api/types/jobs';
import { resumeDocument } from '../../lib/jobs/api';
import { Problem, problemOf, type ProblemInfo } from './Problem';
import styles from './PausedNotice.module.css';

export interface PausedNoticeProps {
  /** Document slug or id. */
  documentRef: string;
  paused: PausedState;
  /** Shown before the reason when several documents are listed. */
  title?: string;
  api?: Pick<ApiClient, 'post' | 'delete'>;
  /** Without it the notice turns into a short confirmation once resumed. */
  onResumed?: (requeued: JobPublic[]) => void;
}

const sentence = (text: string) => {
  const trimmed = text.trim();
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

export function PausedNotice({ documentRef, paused, title, api = browserApi, onResumed }: PausedNoticeProps) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [requeued, setRequeued] = useState<number | null>(null);

  const resume = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { requeued: jobs } = await resumeDocument(api, documentRef);
      if (onResumed) onResumed(jobs);
      else setRequeued(jobs.length);
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };

  if (requeued !== null) {
    return (
      <p className={styles.done} role="status">
        Resumed. {requeued === 1 ? '1 stopped job is' : `${requeued} stopped jobs are`} queued again.
      </p>
    );
  }

  return (
    <div className={styles.notice} role="region" aria-label={title ? `${title} is paused` : 'Paused'}>
      <p className={styles.title}>{title ? `${title}: paused at the run ceiling` : 'Paused at the run ceiling'}</p>
      <p>
        {sentence(paused.reason)} No more model runs are spent on it until you resume; review what it produced first if the
        runs look wasted.
      </p>
      <p className={styles.actions}>
        <button type="button" onClick={() => void resume()} disabled={busy}>
          {busy ? 'Resuming…' : 'Resume'}
        </button>
        <span className={styles.hint}>Gives it another full allowance and requeues the stopped jobs.</span>
      </p>
      {problem ? <Problem inline title="The document was not resumed." problem={problem} /> : null}
    </div>
  );
}
