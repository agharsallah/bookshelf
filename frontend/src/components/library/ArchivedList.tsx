/**
 * The archived books, each with Restore (back on the shelf as it was) and a delete for
 * good. A row leaves the list once either is done.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { DocumentPublic } from '../../lib/api/types/documents';
import { archivedOn, restoreDocument } from '../../lib/documents/archive';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { RemoveDialog } from '../document/RemoveDialog';
import { toast } from '../document/toast';
import styles from './ArchivedList.module.css';

export type ArchivedBook = Pick<DocumentPublic, 'id' | 'slug' | 'title' | 'authors' | 'source_path' | 'archived_at'>;

export interface ArchivedListProps {
  books: ArchivedBook[];
  api?: Pick<ApiClient, 'post' | 'delete'>;
}

export function ArchivedList({ books: initial, api = browserApi }: ArchivedListProps) {
  const [books, setBooks] = useState(initial);
  const [deleting, setDeleting] = useState<ArchivedBook | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; info: ProblemInfo } | null>(null);

  const drop = (id: string) => setBooks((current) => current.filter((b) => b.id !== id));

  const restore = async (book: ArchivedBook) => {
    setBusy(book.id);
    setProblem(null);
    try {
      await restoreDocument(api, book.slug);
      drop(book.id);
      toast(`“${book.title}” is back on the shelf.`, 'good');
    } catch (error) {
      setProblem({ id: book.id, info: problemOf(error) });
    } finally {
      setBusy(null);
    }
  };

  if (books.length === 0) {
    return (
      <p className={styles.empty}>
        Nothing is archived. <a href="/library">Back to the library</a>
      </p>
    );
  }

  return (
    <>
      <ul className={styles.list}>
        {books.map((book) => (
          <li key={book.id} className={styles.row}>
            <div className={styles.what}>
              <a className={`${styles.title} book-title`} href={`/documents/${encodeURIComponent(book.slug)}`}>
                {book.title}
              </a>
              <span className={styles.meta}>
                {[book.authors.join(', '), book.archived_at ? `archived ${archivedOn(book.archived_at)}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.restore} disabled={busy !== null} onClick={() => void restore(book)}>
                {busy === book.id ? 'Restoring…' : 'Restore'}
              </button>
              <button type="button" className={styles.delete} disabled={busy !== null} onClick={() => setDeleting(book)}>
                Delete…
              </button>
            </div>
            {problem?.id === book.id ? <Problem inline title="The book was not restored." problem={problem.info} /> : null}
          </li>
        ))}
      </ul>
      <RemoveDialog
        open={deleting !== null}
        documentRef={deleting?.slug ?? ''}
        title={deleting?.title ?? ''}
        sourcePath={deleting?.source_path ?? null}
        archived
        api={api}
        onClose={() => setDeleting(null)}
        onArchived={() => setDeleting(null)}
        onDeleted={() => {
          if (deleting) {
            drop(deleting.id);
            toast(`“${deleting.title}” was deleted.`, 'good');
          }
          setDeleting(null);
        }}
      />
    </>
  );
}

export default ArchivedList;
