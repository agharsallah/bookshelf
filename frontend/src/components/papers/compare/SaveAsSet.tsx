/**
 * "Save as set & synthesize": keeps the compared papers as a named paper set
 * (`POST /paper-sets`), queues its synthesis (`POST /paper-sets/{id}/synthesis`) and goes
 * to the set's page, which follows the job. A synthesis needs two papers or more.
 */
import { useRef, useState } from 'react';
import { browserApi, type ApiClient } from '../../../lib/api/client';
import { createPaperSet, synthesizeSet } from '../../../lib/papers/shelf-api';
import { problemOf } from '../../common/Problem';
import styles from './Compare.module.css';

export interface SaveAsSetProps {
  documentIds: string[];
  defaultName: string;
  api?: Pick<ApiClient, 'post' | 'delete'>;
  /** Where to go once saved (tests pass a spy). */
  go?: (href: string) => void;
}

export function SaveAsSet({ documentIds, defaultName, api = browserApi, go = (href) => location.assign(href) }: SaveAsSetProps) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enough = documentIds.length >= 2;
  // A set saved on an earlier try whose synthesis failed: a retry only queues the synthesis.
  const saved = useRef<string | null>(null);

  const save = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      saved.current ??= (await createPaperSet(api, { name: name.trim() || defaultName, document_ids: documentIds })).id;
      await synthesizeSet(api, saved.current);
      go(`/papers/sets/${saved.current}`);
    } catch (problem) {
      setError(problemOf(problem).message);
      setBusy(false);
    }
  };

  return (
    <form className={styles.save} data-demo-off onSubmit={(e) => void save(e)}>
      <label className={styles.saveField}>
        <span>Set name</span>
        <input type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} disabled={busy || saved.current !== null} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy || !enough} aria-busy={busy || undefined}>
        {busy ? 'Saving…' : 'Save as set and synthesize'}
      </button>
      <span className={styles.saveNote} aria-live="polite">
        {!enough ? 'Pick at least two papers to synthesize.' : null}
        {error ? <span className={styles.error}>{error}</span> : null}
      </span>
    </form>
  );
}

export default SaveAsSet;
