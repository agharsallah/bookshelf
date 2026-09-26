/**
 * Says so when queued jobs have no worker to run them (`QueueStatus.unclaimed_kinds`):
 * the one queue state that never resolves on its own. Renders nothing otherwise.
 */
import type { QueueStatus } from '../../lib/api/types/jobs';
import { jobName } from '../document/jobs';
import styles from './QueueBanner.module.css';

export function QueueBanner({ queue }: { queue: QueueStatus | null }) {
  if (!queue || queue.unclaimed_kinds.length === 0) return null;
  const kinds = queue.unclaimed_kinds.map((k) => jobName(k).toLowerCase()).join(', ');
  const none = queue.workers.length === 0;
  return (
    <div className={styles.banner} role="alert">
      <strong>{none ? 'No worker is running.' : `No worker runs ${kinds} jobs.`}</strong>{' '}
      {none ? 'Queued jobs will wait until one starts.' : 'Those jobs will wait until one does.'} Restart the API (it runs a worker unless{' '}
      <code>BOOKSHELF_API_WORKER=false</code>) or run <code>uv run python -m app.jobs.worker</code> in <code>backend/</code>.
    </div>
  );
}

export default QueueBanner;
