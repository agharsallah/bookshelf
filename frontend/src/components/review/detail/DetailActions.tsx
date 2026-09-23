/** The reviewer's verbs for one artifact, and what the last one did. */
import type { ReactNode } from 'react';
import type { ArtifactPublic } from '../../../lib/api/types/artifacts';
import { Problem, type ProblemInfo } from '../../common/Problem';
import styles from './Detail.module.css';

export interface DetailActionsProps {
  artifact: ArtifactPublic;
  /** What a re-run would run (a job kind, or a derive skill's name), if anything can. */
  rerun: string | null;
  busy: boolean;
  editing: boolean;
  status: ReactNode;
  problem: ProblemInfo | null;
  onApprove: () => void;
  onReject: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onRerun: () => void;
  onWrite: () => void;
}

export function DetailActions({ artifact, rerun, busy, editing, status, problem, onApprove, onReject, onReopen, onEdit, onRerun, onWrite }: DetailActionsProps) {
  const settled = artifact.review === 'approved' || artifact.review === 'rejected';
  return (
    <div className={styles.actionsWrap}>
      <div className={styles.actions} role="group" aria-label="Review actions">
        <button type="button" className={styles.approve} onClick={onApprove} disabled={busy || editing || artifact.review === 'approved'}>
          Approve
        </button>
        <button type="button" className={styles.action} onClick={onReject} disabled={busy || editing || artifact.review === 'rejected'}>
          Reject
        </button>
        <button type="button" className={styles.action} onClick={onEdit} disabled={busy || editing}>
          Edit
        </button>
        {settled ? (
          <button type="button" className={styles.action} onClick={onReopen} disabled={busy || editing} title="Undo the verdict: back to the queue as a draft">
            Back to draft
          </button>
        ) : null}
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.quiet}
          onClick={onRerun}
          disabled={busy || !rerun}
          title={rerun ? `Enqueue ${rerun} for this scope, even though its inputs have not changed` : 'This artifact type cannot be re-run from here'}
        >
          Re-run
        </button>
        <button type="button" className={styles.quiet} onClick={onWrite} disabled={busy || editing}>
          Write by hand
        </button>
      </div>
      <div aria-live="polite" className={styles.status}>
        {status}
        {settled && !status ? <p>This version was {artifact.review}; you can still change your mind or send it back to draft.</p> : null}
      </div>
      {problem ? <Problem title="That did not go through." problem={problem} inline /> : null}
    </div>
  );
}
