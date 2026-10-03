/**
 * The confirmation before a sync replaces one database with the other: both side by side,
 * a warning when the one being replaced changed last, and a backup of it (on by default).
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { DatabaseStatus, DatabaseTarget, DatabaseTargetPublic } from '../../lib/api/types/database';
import { countsLine, lastChangeLine, other, overwriteWarning, syncVerb, targetOf } from './database';
import styles from './Database.module.css';

export interface SyncDialogProps {
  status: DatabaseStatus;
  /** The database copied from; null keeps the dialog closed. */
  source: DatabaseTarget | null;
  busy: boolean;
  onConfirm: (backup: boolean) => void;
  onClose: () => void;
}

function Side({ role, target }: { role: string; target: DatabaseTargetPublic | undefined }) {
  return (
    <div className={styles.side}>
      <span className={styles.role}>{role}</span>
      <strong>{target?.label}</strong>
      {target?.counts ? (
        <>
          <span>{countsLine(target.counts)}</span>
          <span className={styles.muted}>{lastChangeLine(target.counts)}</span>
        </>
      ) : null}
    </div>
  );
}

export function SyncDialog({ status, source, busy, onConfirm, onClose }: SyncDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [backup, setBackup] = useState(status.can_back_up);
  const id = useId();
  const open = source !== null;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close?.();
    if (open) setBackup(status.can_back_up);
  }, [open, status.can_back_up]);

  const from = source ? targetOf(status, source) : undefined;
  const to = source ? targetOf(status, other(source)) : undefined;
  const warning = source ? overwriteWarning(status, source) : null;
  const labelOf = (t: DatabaseTarget) => targetOf(status, t)?.label ?? t;

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} onClose={onClose} onCancel={onClose}>
      {source ? (
        <>
          <h2 id={`${id}-title`} className={styles.dialogTitle}>
            Replace {to?.label}&rsquo;s library with {from?.label}&rsquo;s?
          </h2>
          <div className={styles.route}>
            <Side role="Copied from" target={from} />
            <span className={styles.arrow} aria-hidden="true">→</span>
            <Side role="Replaced" target={to} />
          </div>
          <p className={styles.muted}>
            Every document, note, highlight, study item, collection and reading position on {to?.label} is replaced by{' '}
            {from?.label}&rsquo;s, in one go: if anything fails halfway, {to?.label} is left exactly as it was. Files in{' '}
            <code>library/</code> and the search index are shared and stay as they are.
          </p>
          {warning ? (
            <p className={styles.warning} role="alert">
              {warning}
            </p>
          ) : null}
          <label className={styles.backup}>
            <input type="checkbox" checked={backup} disabled={!status.can_back_up || busy} onChange={(e) => setBackup(e.target.checked)} />
            <span>
              Back up {to?.label} first
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
            <button
              type="button"
              className={warning ? styles.danger : styles.primary}
              disabled={busy}
              onClick={() => onConfirm(backup)}
            >
              {busy ? 'Starting…' : syncVerb(source, labelOf)}
            </button>
          </form>
        </>
      ) : null}
    </dialog>
  );
}
