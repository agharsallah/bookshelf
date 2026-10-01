/**
 * How a book leaves the shelf, from its page. On the shelf: one button that opens the
 * choice (archive, or delete for good). Archived: a notice at the top of the page with
 * Restore, and the delete. Archiving and restoring reload the page; a delete goes back
 * to the library.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { archivedOn, restoreDocument } from '../../lib/documents/archive';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { RemoveDialog } from './RemoveDialog';
import styles from './RemoveBook.module.css';

export interface RemoveBookProps {
  /** Document slug or id. */
  documentRef: string;
  title: string;
  sourcePath: string | null;
  archivedAt: string | null;
  api?: Pick<ApiClient, 'post' | 'delete'>;
  /** Where to go once done: a URL, or null to reload this page. */
  go?: (href: string | null) => void;
}

export const LIBRARY_HREF = '/library';

const reloadOrGo = (href: string | null) => {
  if (href === null) window.location.reload();
  else window.location.assign(href);
};

export function RemoveBook({ documentRef, title, sourcePath, archivedAt, api = browserApi, go = reloadOrGo }: RemoveBookProps) {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);

  const restore = async () => {
    setRestoring(true);
    setProblem(null);
    try {
      await restoreDocument(api, documentRef);
      go(null);
    } catch (error) {
      setProblem(problemOf(error));
      setRestoring(false);
    }
  };

  const dialog = (
    <RemoveDialog
      open={open}
      documentRef={documentRef}
      title={title}
      sourcePath={sourcePath}
      archived={archivedAt !== null}
      api={api}
      onClose={() => setOpen(false)}
      onArchived={() => go(null)}
      onDeleted={() => go(LIBRARY_HREF)}
    />
  );

  if (archivedAt === null) {
    return (
      <>
        <button type="button" className={styles.remove} onClick={() => setOpen(true)}>
          Archive or delete…
        </button>
        {dialog}
      </>
    );
  }

  return (
    <div className={styles.notice} role="region" aria-label="Archived">
      <p className={styles.title}>Archived on {archivedOn(archivedAt)}</p>
      <p>
        It is off the shelf: hidden from the library, search and your reviews, with its pipeline on hold. Everything it
        had is kept.
      </p>
      <p className={styles.actions}>
        <button type="button" className={styles.restore} onClick={() => void restore()} disabled={restoring}>
          {restoring ? 'Restoring…' : 'Restore to the shelf'}
        </button>
        <button type="button" className={styles.quiet} onClick={() => setOpen(true)} disabled={restoring}>
          Delete for good…
        </button>
      </p>
      {problem ? <Problem inline title="The book was not restored." problem={problem} /> : null}
      {dialog}
    </div>
  );
}

export default RemoveBook;
