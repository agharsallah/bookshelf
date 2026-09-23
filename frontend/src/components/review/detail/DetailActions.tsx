/** The reviewer's verbs for one artifact, and what the last one did. */
import type { ReactNode } from 'react';
import type { ArtifactPublic } from '../../../lib/api/types/artifacts';
import type { JobKind } from '../../../lib/api/types/jobs';
import { Problem, type ProblemInfo } from '../../document/Problem';
import styles from './Detail.module.css';

export interface DetailActionsProps {
  artifact: ArtifactPublic;
  rerun: JobKind | null;
  busy: boolean;
  editing: boolean;
  status: ReactNode;
  problem: ProblemInfo | null;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onRerun: () => void;
  onWrite: () => void;
}

export function DetailActions({ artifact, rerun, busy, editing, status, problem, onApprove, onReject, onEdit, onRerun, onWrite }: DetailActionsProps) {
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
        {settled && !status ? <p>This version was {artifact.review}; you can still change your mind.</p> : null}
      </div>
      {problem ? <Problem title="That did not go through." problem={problem} inline /> : null}
    </div>
  );
}
