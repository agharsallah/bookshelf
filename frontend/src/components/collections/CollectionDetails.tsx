/**
 * A collection's name and description, edited in place, and deleting it (the documents
 * stay on the shelf). The slug does not change on rename, so links keep working.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { deleteCollection, updateCollection } from '../../lib/collections/api';
import { problemOf } from '../common/Problem';
import styles from './Collections.module.css';

export interface CollectionDetailsProps {
  slug: string;
  name: string;
  description: string | null;
  api?: Pick<ApiClient, 'patch' | 'delete'>;
  go?: (href: string) => void;
  confirm?: (question: string) => boolean;
}

export function CollectionDetails({
  slug,
  name: initialName,
  description: initialDescription,
  api = browserApi,
  go = (href) => location.assign(href),
  confirm = (question) => window.confirm(question),
}: CollectionDetailsProps) {
  const [saved, setSaved] = useState({ name: initialName, description: initialDescription });
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setError(null);
    try {
      const next = await updateCollection(api, slug, { name: draft.name.trim(), description: draft.description?.trim() || null });
      setSaved({ name: next.name, description: next.description });
      setEditing(false);
    } catch (problem) {
      setError(problemOf(problem).message);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the collection “${saved.name}”? Its books, papers and articles stay on the shelf.`)) return;
    try {
      await deleteCollection(api, slug);
      go('/collections');
    } catch (problem) {
      setError(problemOf(problem).message);
    }
  };

  return editing ? (
    <form className={styles.form} onSubmit={(e) => void save(e)}>
      <label>
        <span>Name</span>
        <input type="text" value={draft.name} maxLength={200} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label>
        <span>What it is for</span>
        <textarea value={draft.description ?? ''} maxLength={2000} rows={2} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </label>
      <span className={styles.noteActions}>
        <button type="submit" className="btn btn-primary" disabled={!draft.name.trim()}>
          Save
        </button>
        <button type="button" className={styles.link} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </span>
      <p className={styles.error} aria-live="polite">
        {error}
      </p>
    </form>
  ) : (
    <div className={styles.details}>
      <h1>{saved.name}</h1>
      {saved.description && <p className={styles.lede}>{saved.description}</p>}
      <span className={styles.noteActions}>
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            setDraft(saved);
            setEditing(true);
          }}
        >
          Rename or describe
        </button>
        <button type="button" className={styles.link} onClick={() => void remove()}>
          Delete collection
        </button>
      </span>
      <p className={styles.error} aria-live="polite">
        {error}
      </p>
    </div>
  );
}

export default CollectionDetails;
