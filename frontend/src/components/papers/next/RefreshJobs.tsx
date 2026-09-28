/**
 * The two slow jobs behind the reading queue, each with its live state: rebuild the
 * suggestions from the shelf (`paper_candidates`, which then asks the model for reasons),
 * and ask OpenAlex for new papers citing the ones you watch (`paper_watch`). Once one is
 * done, the page offers to reload with the new ranking.
 */
import { browserApi, type ApiClient } from '../../../lib/api/client';
import type { JobPublic } from '../../../lib/api/types/jobs';
import { refreshCandidates, refreshWatch } from '../../../lib/papers/api';
import { useJobRun } from '../useJobRun';
import styles from './Next.module.css';

export interface RefreshJobsProps {
  /** Jobs already under way when the page loaded. */
  refreshing?: JobPublic | null;
  watching?: JobPublic | null;
  api?: Pick<ApiClient, 'post' | 'put' | 'patch' | 'delete'>;
}

function JobButton({ label, run, primary = false }: { label: string; run: ReturnType<typeof useJobRun>; primary?: boolean }) {
  return (
    <div className={styles.job} data-phase={run.progress?.phase ?? 'idle'}>
      {run.finished ? (
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
          Show the new suggestions
        </button>
      ) : (
        <button type="button" className={primary ? 'btn btn-primary' : 'btn'} disabled={run.live} aria-busy={run.live || undefined} onClick={() => void run.start()}>
          {label}
        </button>
      )}
      <span className={styles.status} aria-live="polite">
        {run.sending ? 'Queueing…' : run.progress && !run.finished ? run.progress.text : null}
        {run.progress?.phase === 'failed' && run.job?.error ? <span className={styles.error}>{run.job.error.split('\n')[0]?.slice(0, 160)}</span> : null}
        {run.error ? <span className={styles.error}>Could not start it: {run.error}</span> : null}
      </span>
    </div>
  );
}

export function RefreshJobs({ refreshing = null, watching = null, api = browserApi }: RefreshJobsProps) {
  const refresh = useJobRun(() => refreshCandidates(api), refreshing);
  const watch = useJobRun(() => refreshWatch(api), watching);
  return (
    <div className={styles.jobs}>
      <JobButton label="Refresh suggestions" run={refresh} primary />
      <JobButton label="Check watched papers" run={watch} />
    </div>
  );
}

export default RefreshJobs;
