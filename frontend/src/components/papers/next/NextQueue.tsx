/**
 * The ranked reading queue (island). Status moves go through
 * `PATCH /papers/candidates/{id}` and show at once; a dismissed paper folds into one line
 * with "Undo", which restores the status it had. Bars share one scale across the page.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../../lib/api/client';
import type { CandidateStatus, ReadingCandidatePublic } from '../../../lib/api/types/papers';
import { setCandidateStatus } from '../../../lib/papers/api';
import { problemOf } from '../../common/Problem';
import { CandidateCard } from './CandidateCard';
import { moveTarget, undoTarget, type CandidateMove, type ShelfIndex } from './candidates';
import { scoreScale } from './score';
import styles from './Next.module.css';

export interface NextQueueProps {
  candidates: ReadingCandidatePublic[];
  shelf: ShelfIndex;
  api?: Pick<ApiClient, 'post' | 'put' | 'patch' | 'delete'>;
}

interface Row {
  candidate: ReadingCandidatePublic;
  /** Status before a dismissal made here, for Undo. */
  before: CandidateStatus | null;
  busy: boolean;
  error: string | null;
}

export function NextQueue({ candidates, shelf, api = browserApi }: NextQueueProps) {
  const [rows, setRows] = useState<Row[]>(() => candidates.map((candidate) => ({ candidate, before: null, busy: false, error: null })));
  const scale = scoreScale(candidates.map((c) => c.score_parts));
  const patch = (id: string, change: Partial<Row>) => setRows((all) => all.map((r) => (r.candidate.id === id ? { ...r, ...change } : r)));

  const send = async (row: Row, status: Exclude<CandidateStatus, 'ingested'> | null, before: CandidateStatus | null) => {
    if (!status) return;
    const id = row.candidate.id;
    patch(id, { busy: true, error: null });
    try {
      const updated = await setCandidateStatus(api, id, status);
      patch(id, { candidate: updated, before, busy: false });
    } catch (problem) {
      patch(id, { busy: false, error: problemOf(problem).message });
    }
  };

  const move = (row: Row, m: CandidateMove) =>
    void send(row, moveTarget(row.candidate.status, m), m === 'dismiss' ? row.candidate.status : null);
  const undo = (row: Row) => void send(row, row.before ? undoTarget(row.before) : null, null);

  return (
    <ol className={styles.queue} aria-label="Suggested papers, best first">
      {rows.map((row, i) =>
        row.before !== null && row.candidate.status === 'dismissed' ? (
          <li key={row.candidate.id} className={styles.dismissed}>
            <span>
              Dismissed <em>{row.candidate.title}</em>.
            </span>
            <button type="button" className={styles.linkButton} disabled={row.busy} onClick={() => undo(row)}>
              Undo
            </button>
            {row.error ? <span className={styles.error}>{row.error}</span> : null}
          </li>
        ) : (
          <li key={row.candidate.id}>
            <CandidateCard
              candidate={row.candidate}
              rank={i + 1}
              shelf={shelf}
              scale={scale}
              busy={row.busy}
              error={row.error}
              onMove={(m) => move(row, m)}
              api={api}
            />
          </li>
        ),
      )}
    </ol>
  );
}

export default NextQueue;
