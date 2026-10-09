/**
 * A bibliography entry that is a reading candidate: its place in the reading queue, and
 * the one action that fits (`PATCH /papers/candidates/{id}`): add a suggestion to the
 * queue, or take a queued one out again.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { CandidateStatus } from '../../lib/api/types/papers';
import { setCandidateStatus } from '../../lib/papers/api';
import { problemOf } from '../common/Problem';
import styles from './PaperShelf.module.css';

export interface CandidateActionProps {
  id: string;
  status: CandidateStatus;
  api?: Pick<ApiClient, 'post' | 'put' | 'patch' | 'delete'>;
}

const STATUS_WORDS: Record<CandidateStatus, string> = {
  suggested: 'Suggested',
  queued: 'In your reading queue',
  dismissed: 'Dismissed',
  ingested: 'Added to the shelf',
};

export function CandidateAction({ id, status: initial, api = browserApi }: CandidateActionProps) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: 'queued' | 'suggested') => {
    setBusy(true);
    setError(null);
    try {
      setStatus((await setCandidateStatus(api, id, next)).status);
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={styles.candidate} data-demo-off data-status={status}>
      <span aria-live="polite">{STATUS_WORDS[status]}</span>
      {status === 'suggested' || status === 'dismissed' ? (
        <button type="button" className={styles.linkButton} disabled={busy} onClick={() => void change('queued')}>
          Add to reading queue
        </button>
      ) : status === 'queued' ? (
        <button type="button" className={styles.linkButton} disabled={busy} onClick={() => void change('suggested')}>
          Take out
        </button>
      ) : null}
      {error ? <span className={styles.error}>{error}</span> : null}
    </span>
  );
}

export default CandidateAction;
