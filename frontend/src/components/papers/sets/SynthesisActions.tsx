/**
 * What you can do with a set's synthesis: approve or reject the version on show
 * (`POST …/synthesis/{version}/review`), and write it (or write it again, `force`, which
 * makes a new draft version) with the job followed live. Once the job is done the page
 * reloads on request onto the default version.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../../lib/api/client';
import type { Review } from '../../../lib/api/types/artifacts';
import type { JobPublic } from '../../../lib/api/types/jobs';
import { reviewSynthesis, synthesizeSet } from '../../../lib/papers/shelf-api';
import { problemOf } from '../../common/Problem';
import { useJobRun } from '../useJobRun';
import { verdictsFor } from './set';
import styles from './Sets.module.css';

export interface SynthesisActionsProps {
  setId: string;
  /** The version on show; null when there is none yet. */
  version: number | null;
  review: Review | null;
  /** A synthesis needs two papers or more. */
  canWrite: boolean;
  initialJob?: JobPublic | null;
  api?: Pick<ApiClient, 'post' | 'delete'>;
}

export function SynthesisActions({ setId, version, review, canWrite, initialJob = null, api = browserApi }: SynthesisActionsProps) {
  const run = useJobRun(() => synthesizeSet(api, setId, version !== null), initialJob);
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const judge = async (verdict: 'approve' | 'reject') => {
    if (version === null) return;
    setJudging(true);
    setError(null);
    try {
      await reviewSynthesis(api, setId, version, verdict);
      location.reload();
    } catch (problem) {
      setError(problemOf(problem).message);
      setJudging(false);
    }
  };

  return (
    <div className={styles.actions}>
      {version !== null && review
        ? verdictsFor(review).map((v) => (
            <button key={v} type="button" className={v === 'approve' ? 'btn btn-primary' : 'btn'} disabled={judging || run.live} onClick={() => void judge(v)}>
              {v === 'approve' ? 'Approve' : 'Reject'}
            </button>
          ))
        : null}
      {run.finished ? (
        <a className="btn btn-primary" href={`/papers/sets/${setId}`}>
          Show the new synthesis
        </a>
      ) : canWrite ? (
        <button type="button" className={version === null ? 'btn btn-primary' : 'btn btn-quiet'} disabled={run.live || judging} aria-busy={run.live || undefined} onClick={() => void run.start()}>
          {version === null ? 'Write the synthesis' : 'Write it again'}
        </button>
      ) : null}
      <span className={styles.status} aria-live="polite">
        {run.sending ? 'Queueing…' : run.progress && !run.finished ? run.progress.text : null}
        {run.progress?.phase === 'failed' && run.job?.error ? <span className={styles.error}>{run.job.error.split('\n')[0]?.slice(0, 160)}</span> : null}
        {run.error ? <span className={styles.error}>Could not start it: {run.error}</span> : null}
        {error ? <span className={styles.error}>{error}</span> : null}
      </span>
    </div>
  );
}

export default SynthesisActions;
