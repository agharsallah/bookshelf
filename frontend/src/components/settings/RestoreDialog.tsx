/**
 * The confirmation before a snapshot replaces everything here: which file, what it
 * replaces, and a backup of the database first (on by default when pg_dump is there).
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { SnapshotStatus } from '../../lib/api/types/snapshots';
import { formatSize } from '../library/ingest';
import styles from './Database.module.css';

export interface RestoreDialogProps {
  status: SnapshotStatus;
  /** The snapshot picked; null keeps the dialog closed. */
  file: File | null;
  busy: boolean;
  onConfirm: (backup: boolean) => void;
  onClose: () => void;
}

export function RestoreDialog({ status, file, busy, onConfirm, onClose }: RestoreDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [backup, setBackup] = useState(status.can_back_up);
  const id = useId();
  const open = file !== null;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close?.();
    if (open) setBackup(status.can_back_up);
  }, [open, status.can_back_up]);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} onClose={onClose} onCancel={onClose}>
      {file ? (
        <>
          <h2 id={`${id}-title`} className={styles.dialogTitle}>
            Replace everything on {status.database} with this snapshot?
          </h2>
          <p>
            <code>{file.name}</code> · {formatSize(file.size)}
          </p>
          <p className={styles.muted}>
            Every document, note, highlight, study item, collection, reading position and job is replaced by the snapshot&rsquo;s, in one
            go, and so are the files in <code>library/</code>, the figures and the audio. The folders it replaces are kept under{' '}
            <code>.backups/snapshots/before-restore/</code> until the next restore. Search is then rebuilt in the queue.
          </p>
          <p className={styles.warning} role="alert">
            Whatever is only here now will be gone from the library.
          </p>
          <label className={styles.backup}>
            <input type="checkbox" checked={backup} disabled={!status.can_back_up || busy} onChange={(e) => setBackup(e.target.checked)} />
            <span>
              Back up {status.database} first
              <small>
                {status.can_back_up
                  ? 'Recommended. Saved under .backups/database/; pg_restore --data-only reads it back.'
                  : 'pg_dump is not installed, so no backup can be made.'}
              </small>
            </span>
          </label>
          <form method="dialog" className={styles.actions}>
            <button type="submit" className={styles.secondary} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={styles.danger} disabled={busy} onClick={() => onConfirm(backup)}>
              {busy ? 'Uploading…' : 'Restore'}
            </button>
          </form>
        </>
      ) : null}
    </dialog>
  );
}
