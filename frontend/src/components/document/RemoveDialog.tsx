/**
 * The choice of how a book leaves the shelf, in a modal dialog: archive it (hidden from
 * the library, search and reviews, everything kept, restorable any day) or delete it
 * for good, with the original file in `library/` too if you ask. An archived book is
 * offered only the delete.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { archiveDocument, deleteDocument } from '../../lib/documents/archive';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import styles from './RemoveDialog.module.css';

export interface RemoveDialogProps {
  open: boolean;
  /** Document slug or id. */
  documentRef: string;
  title: string;
  /** `library/x.pdf`; without one (or for a fetched article) there is no file to offer. */
  sourcePath: string | null;
  archived: boolean;
  api?: Pick<ApiClient, 'post' | 'delete'>;
  onClose: () => void;
  onArchived: () => void;
  onDeleted: () => void;
}

type Busy = 'archive' | 'delete' | null;

export function RemoveDialog(props: RemoveDialogProps) {
  const { open, documentRef, title, sourcePath, archived, api = browserApi, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [withFile, setWithFile] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<{ action: Exclude<Busy, null>; info: ProblemInfo } | null>(null);
  const id = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close?.();
    if (!open) {
      setWithFile(false);
      setProblem(null);
    }
  }, [open]);

  const run = async (kind: Exclude<Busy, null>) => {
    setBusy(kind);
    setProblem(null);
    try {
      if (kind === 'archive') {
        await archiveDocument(api, documentRef);
        props.onArchived();
      } else {
        await deleteDocument(api, documentRef, { file: withFile });
        props.onDeleted();
      }
    } catch (error) {
      setProblem({ action: kind, info: problemOf(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} onClose={onClose} onCancel={onClose}>
      <h2 id={`${id}-title`} className={styles.title}>
        {archived ? `Delete “${title}” for good?` : `Remove “${title}” from the shelf`}
      </h2>

      {archived ? null : (
        <section className={styles.option} aria-labelledby={`${id}-archive`}>
          <h3 id={`${id}-archive`}>Archive it</h3>
          <p>
            It leaves the library, search and your reviews, and its pipeline stops. Notes, highlights, study material and
            reading progress are all kept: restore it any day and it comes back as it was.
          </p>
          <button type="button" className={styles.archive} disabled={busy !== null} onClick={() => void run('archive')}>
            {busy === 'archive' ? 'Archiving…' : 'Archive'}
          </button>
        </section>
      )}

      <section className={`${styles.option} ${styles.danger}`} aria-labelledby={`${id}-delete`}>
        <h3 id={`${id}-delete`}>Delete it for good</h3>
        <p>
          Its chapters, notes, highlights, summaries, study material, narrations, reading progress and review history are
          deleted. This cannot be undone.
        </p>
        {sourcePath ? (
          <label className={styles.file}>
            <input type="checkbox" checked={withFile} onChange={(e) => setWithFile(e.target.checked)} />
            <span>
              Also delete the original file <code>{sourcePath}</code>
              <span className={styles.hint}>{withFile ? '' : ' (kept by default, so you can add it again)'}</span>
            </span>
          </label>
        ) : null}
        <button type="button" className={styles.delete} disabled={busy !== null} onClick={() => void run('delete')}>
          {busy === 'delete' ? 'Deleting…' : withFile ? 'Delete it and its file' : 'Delete for good'}
        </button>
      </section>

      {problem ? (
        <Problem
          inline
          title={problem.action === 'archive' ? 'The book was not archived.' : 'The book was not deleted.'}
          problem={problem.info}
        />
      ) : null}

      <form method="dialog" className={styles.footer}>
        <button type="submit" className={styles.cancel} onClick={onClose} disabled={busy !== null}>
          Cancel
        </button>
      </form>
    </dialog>
  );
}

export default RemoveDialog;
