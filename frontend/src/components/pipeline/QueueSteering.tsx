/**
 * Steer the queue by kind and by book (`PATCH /jobs/queue`). Closed by default: its header
 * shows each active choice as a chip that undoes it in one click, so the panel needs
 * opening only to change something. Open, kinds with queued work (or already steered) sit
 * as tiles under their stage, each run as usual, first, on hold, or (for the enrich kinds
 * whose stage moves on without them) skipped as it comes up. Books can be put first. A
 * job sent to run now ignores all of it; workers follow a change on their next pick.
 */
import type { ApiClient } from '../../lib/api/client';
import type { QueueStatus } from '../../lib/api/types/jobs';
import { Problem } from '../common/Problem';
import type { DocumentLabel } from '../review/api';
import { KindModeTile, KindModeTiles } from './KindModeTile';
import { QUEUE_SETTINGS_HREF, steeringChips, steeringGroups, steeringRows } from './steering';
import { useQueueUpdate } from './useQueueUpdate';
import styles from './QueueSteering.module.css';

export interface QueueSteeringProps {
  queue: QueueStatus;
  documents: readonly DocumentLabel[];
  api: Pick<ApiClient, 'patch'>;
  onChanged: (queue: QueueStatus) => void;
}

export function QueueSteering({ queue, documents, api, onChanged }: QueueSteeringProps) {
  const { send, sending, problem } = useQueueUpdate(api, onChanged);
  const titles = new Map(documents.map((d) => [d.id, d.title]));
  const titleOf = (id: string) => titles.get(id) ?? 'Unknown document';
  const rows = steeringRows(queue);
  const chips = steeringChips(queue, titleOf);
  const first = queue.first_documents ?? [];
  const most = Math.max(1, ...rows.map((r) => r.queued));

  return (
    <section className={styles.steering} aria-label="Priorities">
      <details className={styles.disclosure}>
        <summary>
          <span className={styles.chevron} aria-hidden="true" />
          <span className={styles.title}>Priorities</span>
          {chips.length === 0 ? <span className={styles.quiet}>The pipeline’s own order</span> : null}
          <span className={styles.adjust}>Adjust</span>
        </summary>
        <div className={styles.body}>
          {steeringGroups(rows).map((group) => (
            <section key={group.label} aria-label={group.label} className={styles.group}>
              <h3 className={styles.groupLabel}>{group.label}</h3>
              <KindModeTiles>
                {group.rows.map((row) => (
                  <KindModeTile key={row.kind} row={row} most={most} disabled={sending} onMode={(mode) => void send({ kinds: { [row.kind]: mode } })} />
                ))}
              </KindModeTiles>
            </section>
          ))}
          {rows.length === 0 ? <p className={styles.quiet}>Nothing is queued.</p> : null}
          <section aria-label="Books first" className={styles.group}>
            <h3 className={styles.groupLabel}>Books first</h3>
            <label className={styles.add}>
              <span className="visually-hidden">Put a book first</span>
              <select value="" disabled={sending} onChange={(e) => e.target.value && void send({ first_documents: [...first, e.target.value] })}>
                <option value="">Put a book first…</option>
                {documents
                  .filter((d) => !first.includes(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
              </select>
            </label>
          </section>
          <p className={styles.note}>
            First goes before other queued work; a first kind of a first book goes before either. Hold keeps jobs waiting, and their books’ later stages wait too.
            Skip drops them like Cancel. Run now on a job ignores all of this. To set a kind before anything of it is queued, see{' '}
            <a href={QUEUE_SETTINGS_HREF}>Settings → Job kinds</a>.
          </p>
        </div>
      </details>
      {chips.length ? (
        <ul className={styles.chips} aria-label="Active priorities">
          {chips.map((chip) => (
            <li key={chip.key} className={styles.chip} data-tone={chip.tone}>
              <span>{chip.text}</span>
              <button type="button" disabled={sending} onClick={() => void send(chip.clear)} aria-label={`Undo: ${chip.text}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {problem ? <Problem title="The priorities were not changed." problem={problem} inline /> : null}
    </section>
  );
}
