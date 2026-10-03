/**
 * Pause and resume every worker at once, and cap how many jobs run together
 * (`PATCH /jobs/queue`). Pausing stops nothing that runs: running jobs finish, queued ones
 * wait their turn until Resume. The cap counts token-spending jobs across all workers; it
 * can never exceed the workers' slots (`BOOKSHELF_WORKER_CONCURRENCY` each).
 */
import { useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { QueueControlsUpdate, QueueStatus } from '../../lib/api/types/jobs';
import { setQueueControls } from '../../lib/jobs/api';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import styles from './QueueControls.module.css';

/** Offered caps go at least this high, so a cap can be set before more workers start. */
const MIN_CHOICES = 8;
const NO_CAP = '';

export interface QueueControlsProps {
  queue: QueueStatus;
  api: Pick<ApiClient, 'patch'>;
  onChanged: (queue: QueueStatus) => void;
}

function summary({ paused, paused_reason, running, queued, max_running, slots }: QueueStatus): string {
  if (paused) {
    const why = paused_reason ? `Paused on its own: ${paused_reason}. ` : 'Paused. ';
    const finishing = running > 0 ? `${running} running ${running === 1 ? 'job finishes' : 'jobs finish'}, then nothing starts. ` : 'Nothing starts. ';
    return `${why}${finishing}${queued} queued ${queued === 1 ? 'waits' : 'wait'} until you resume.`;
  }
  const limit = max_running === null ? slots : Math.min(max_running, slots);
  return `Up to ${limit} ${limit === 1 ? 'job runs' : 'jobs run'} at once.`;
}

export function QueueControls({ queue, api, onChanged }: QueueControlsProps) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const choices = Array.from({ length: Math.max(MIN_CHOICES, queue.slots, queue.max_running ?? 0) }, (_, i) => i + 1);
  const starved = queue.max_running !== null && queue.max_running > queue.slots;

  const send = async (update: QueueControlsUpdate) => {
    setSending(true);
    setProblem(null);
    try {
      onChanged(await setQueueControls(api, update));
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className={styles.controls} data-paused={queue.paused} aria-label="Queue controls">
      <button type="button" className={queue.paused ? 'btn btn-primary' : 'btn'} disabled={sending} onClick={() => void send({ paused: !queue.paused })}>
        {queue.paused ? 'Resume all' : 'Pause all'}
      </button>
      <label className={styles.cap}>
        <span>Run at most</span>
        <select
          value={queue.max_running ?? NO_CAP}
          disabled={sending}
          onChange={(e) => void send({ max_running: e.target.value === NO_CAP ? null : Number(e.target.value) })}
        >
          <option value={NO_CAP}>every slot ({queue.slots})</option>
          {choices.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span>at once</span>
      </label>
      <p className={styles.summary} role="status">
        {summary(queue)}
        {starved ? (
          <>
            {' '}
            The workers have {queue.slots} {queue.slots === 1 ? 'slot' : 'slots'}: raise <code>BOOKSHELF_WORKER_CONCURRENCY</code> or start another worker to run more.
          </>
        ) : null}
      </p>
      {problem ? <Problem title="The queue was not changed." problem={problem} inline /> : null}
    </section>
  );
}

export default QueueControls;
