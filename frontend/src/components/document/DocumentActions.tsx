/** Document-wide jobs: re-parse and write the brief. Each asks before spending a run. */
import { useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { JobKind } from '../../lib/api/types/jobs';
import { enqueue, jobLabel } from './jobs';
import styles from './DocumentActions.module.css';

export interface DocumentActionsProps {
  documentId: string;
  kinds: JobKind[];
}

export function DocumentActions({ documentId, kinds }: DocumentActionsProps) {
  const [busy, setBusy] = useState<JobKind | null>(null);
  const run = async (kind: JobKind) => {
    setBusy(kind);
    await enqueue(browserApi, { kind, documentId });
    setBusy(null);
  };
  return (
    <div className={styles.actions}>
      {kinds.map((kind) => (
        <button key={kind} type="button" disabled={busy !== null} onClick={() => void run(kind)}>
          {busy === kind ? 'Queueing…' : jobLabel(kind)}
        </button>
      ))}
    </div>
  );
}

export default DocumentActions;
