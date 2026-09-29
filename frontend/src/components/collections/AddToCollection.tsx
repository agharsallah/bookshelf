/**
 * Which collections hold this document, and a picker to put it in or take it out of any
 * of them, or to start a new one with it. Each change is saved at once; a failure puts
 * the tick back and says why. If the collections cannot be loaded at all, the picker stays
 * out of the way: it is an extra on the page, never a reason to show an error there.
 */
import { useEffect, useId, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { CollectionPublic } from '../../lib/api/types/collections';
import { createCollection, listCollections, putMember, removeMember } from '../../lib/collections/api';
import { problemOf } from '../common/Problem';
import styles from './Collections.module.css';

export interface AddToCollectionProps {
  documentId: string;
  /** Every collection, when the page already has them; fetched on mount otherwise. */
  initial?: CollectionPublic[] | null;
  api?: Pick<ApiClient, 'get' | 'post' | 'put' | 'delete'>;
}

export function AddToCollection({ documentId, initial = null, api = browserApi }: AddToCollectionProps) {
  const [collections, setCollections] = useState<CollectionPublic[] | null>(initial);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (initial !== null) return;
    listCollections(api)
      .then(setCollections)
      .catch(() => setUnavailable(true));
  }, [api, initial]);

  const holds = (c: CollectionPublic) => c.document_ids.includes(documentId);
  const holding = (collections ?? []).filter(holds);

  const replace = (slug: string, change: (c: CollectionPublic) => CollectionPublic) =>
    setCollections((all) => all?.map((c) => (c.slug === slug ? change(c) : c)) ?? all);

  const toggle = async (c: CollectionPublic) => {
    const inside = holds(c);
    const without = (x: CollectionPublic) => ({ ...x, document_ids: x.document_ids.filter((id) => id !== documentId) });
    const withIt = (x: CollectionPublic) => ({ ...x, document_ids: [...x.document_ids, documentId] });
    setBusy(c.slug);
    setError(null);
    replace(c.slug, inside ? without : withIt);
    try {
      if (inside) await removeMember(api, c.slug, documentId);
      else await putMember(api, c.slug, documentId);
    } catch (problem) {
      replace(c.slug, inside ? withIt : without);
      setError(problemOf(problem).message);
    } finally {
      setBusy(null);
    }
  };

  const create = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy('new');
    setError(null);
    try {
      const made = await createCollection(api, { name: trimmed, document_ids: [documentId] });
      setCollections((all) => [...(all ?? []), made].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setBusy(null);
    }
  };

  if (unavailable) return null;

  return (
    <div className={styles.picker}>
      <ul className={styles.held} aria-label="In collections">
        {holding.map((c) => (
          <li key={c.slug}>
            <a href={`/collections/${c.slug}`}>{c.name}</a>
          </li>
        ))}
        <li>
          <button type="button" className={styles.add} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
            {holding.length ? 'Collections…' : 'Add to a collection'}
          </button>
        </li>
      </ul>
      {open && (
        <div id={panelId} className={styles.panel}>
          {collections === null && <p className={styles.quiet}>Loading collections…</p>}
          {collections !== null && collections.length > 0 && (
            <fieldset className={styles.choices}>
              <legend>Keep this in</legend>
              {collections.map((c) => (
                <label key={c.slug}>
                  <input type="checkbox" checked={holds(c)} disabled={busy === c.slug} onChange={() => void toggle(c)} />
                  {c.name}
                </label>
              ))}
            </fieldset>
          )}
          <form className={styles.create} onSubmit={(e) => void create(e)}>
            <label>
              <span>New collection</span>
              <input type="text" value={name} maxLength={200} placeholder="e.g. Fine-tuning" onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className="btn" disabled={busy === 'new' || !name.trim()}>
              Create with this
            </button>
          </form>
        </div>
      )}
      <p className={styles.error} aria-live="polite">
        {error}
      </p>
    </div>
  );
}

export default AddToCollection;
