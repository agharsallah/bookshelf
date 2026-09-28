/**
 * "Make it now" for a paper tab whose material does not exist yet: queues one job
 * (`POST /jobs`, deduplicated server-side) and follows it live over `/jobs/stream`.
 * When it is done the page is reloaded on request, so the new artifact shows in place.
 * A job already under way (`initialJob`) is followed instead of offering the button.
 */
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { JobCreate, JobPublic } from '../../lib/api/types/jobs';
import { enqueueJob } from '../../lib/jobs/api';
import { useJobRun } from './useJobRun';
import styles from './PaperControls.module.css';

export interface QueueJobProps {
  request: JobCreate;
  /** The button's words ("Explain it for experts"). */
  label: string;
  initialJob?: JobPublic | null;
  api?: Pick<ApiClient, 'post' | 'delete'>;
}

export function QueueJob({ request, label, initialJob = null, api = browserApi }: QueueJobProps) {
  const { start, job, progress, sending, error, live, finished } = useJobRun(async () => (await enqueueJob(api, request)).job, initialJob, request.document_id);

  return (
    <div className={styles.queue} data-phase={progress?.phase ?? 'idle'}>
      {finished ? (
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
          Show it
        </button>
      ) : (
        <button type="button" className="btn btn-primary" disabled={live} aria-busy={live || undefined} onClick={() => void start()}>
          {live ? <span className={styles.spinner} aria-hidden="true" /> : null}
          {progress?.phase === 'failed' ? `${label} again` : label}
        </button>
      )}
      <span className={styles.queueStatus} aria-live="polite">
        {sending ? 'Queueing…' : progress ? (finished ? 'Ready.' : progress.text) : null}
        {progress?.phase === 'failed' && job?.error ? <span className={styles.error}>{job.error.split('\n')[0]?.slice(0, 160)}</span> : null}
        {error ? <span className={styles.error}>Could not queue it: {error}</span> : null}
      </span>
    </div>
  );
}

export default QueueJob;
