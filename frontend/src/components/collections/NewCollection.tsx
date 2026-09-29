/**
 * Start a collection: a name and, if you like, what it is for. Goes to the new collection,
 * where documents are added from the shelf.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { createCollection } from '../../lib/collections/api';
import { problemOf } from '../common/Problem';
import styles from './Collections.module.css';

export interface NewCollectionProps {
  api?: Pick<ApiClient, 'post'>;
  /** Where to go once made (tests pass a spy). */
  go?: (href: string) => void;
}

export function NewCollection({ api = browserApi, go = (href) => location.assign(href) }: NewCollectionProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await createCollection(api, { name: name.trim(), description: description.trim() || null });
      go(`/collections/${made.slug}`);
    } catch (problem) {
      setError(problemOf(problem).message);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)}>
      <label>
        <span>Name</span>
        <input type="text" value={name} maxLength={200} required placeholder="e.g. Fine-tuning" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <span>What it is for (optional)</span>
        <textarea value={description} maxLength={2000} rows={2} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()} aria-busy={busy || undefined}>
        {busy ? 'Starting…' : 'Start the collection'}
      </button>
      <p className={styles.error} aria-live="polite">
        {error}
      </p>
    </form>
  );
}

export default NewCollection;
