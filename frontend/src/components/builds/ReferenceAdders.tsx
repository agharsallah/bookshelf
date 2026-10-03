/**
 * The two ways to add a reference by hand: *Add a link* (a URL, a title, a note, and
 * whether to snapshot it) and *Add from shelf* (search your papers). Both sit inside the
 * build form, so Enter does their own action instead of submitting it.
 */
import { useId, useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildReference } from '../../lib/api/types/builds';
import type { PaperSummary } from '../../lib/api/types/papers';
import { CONTEXT_LIMITS, isAdded, linkReference, shelfReference, validateUrl } from '../../lib/builds/context';
import { listPapers } from '../../lib/papers/api';
import { problemOf } from '../common/Problem';
import { onEnter, Switch } from './Disclosure';
import { Field } from './Field';
import fields from './Fields.module.css';
import styles from './Context.module.css';

export function AddLink({ onAdd, onCancel }: { onAdd: (ref: BuildReference) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [snapshot, setSnapshot] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const problem = validateUrl(url);
    setError(problem);
    if (!problem) onAdd(linkReference(url, title, note, snapshot));
  };

  return (
    <div className={styles.adder} role="group" aria-label="Add a link" onKeyDown={onEnter(add)}>
      <Field label="URL" error={error ?? undefined}>
        <input className={fields.input} type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <div className={fields.row}>
        <Field label="Title" hint="Blank: the site's name.">
          <input className={fields.input} maxLength={CONTEXT_LIMITS.refTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Note" hint="Why it matters, how to use it.">
          <input className={fields.input} maxLength={CONTEXT_LIMITS.refNote} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Switch label="Snapshot: save a readable copy for the agent" checked={snapshot} onChange={setSnapshot} />
      <div className={fields.actions}>
        <button type="button" className="btn" onClick={add}>
          Add the link
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export interface AddFromShelfProps {
  api: Pick<ApiClient, 'get'>;
  /** The paper being built (id or slug), left out of the results. */
  paperRef: string;
  added: readonly BuildReference[];
  full: boolean;
  onAdd: (ref: BuildReference) => void;
}

export function AddFromShelf({ api, paperRef, added, full, onAdd }: AddFromShelfProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PaperSummary[] | null>(null);
  const [status, setStatus] = useState('');

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setStatus('Searching…');
    try {
      const page = await listPapers(api, { q, limit: 8 });
      const found = page.items.filter((p) => p.id !== paperRef && p.slug !== paperRef);
      setResults(found);
      setStatus(found.length ? `${found.length} found.` : 'No paper on your shelf matches.');
    } catch (error) {
      setResults(null);
      setStatus(`Not searched: ${problemOf(error).message}`);
    }
  };

  return (
    <div className={styles.adder} role="group" aria-label="Add from shelf">
      <label className={fields.label} htmlFor={id}>
        Search your shelf
      </label>
      <div className={styles.searchRow}>
        <input id={id} className={fields.input} type="search" placeholder="Title, author…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onEnter(() => void search())} />
        <button type="button" className="btn" disabled={!query.trim()} onClick={() => void search()}>
          Search
        </button>
      </div>
      <p className={fields.hint} role="status">
        {status}
      </p>
      {results && results.length > 0 ? (
        <ul className={styles.results}>
          {results.map((p) => {
            const on = isAdded(added, { kind: 'shelf', url: null, document_id: p.id });
            return (
              <li key={p.id} className={styles.result}>
                <span className={styles.resultTitle}>
                  {p.title}
                  <span className={fields.hint}>
                    {[p.authors[0], p.year].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <button type="button" className="btn btn-quiet" disabled={on || full} aria-label={`Add ${p.title}`} onClick={() => onAdd(shelfReference(p.id, p.title))}>
                  {on ? 'Added' : 'Add'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
