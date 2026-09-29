/**
 * A collection as a reading path: its members in order, each with how far you are, a note
 * on why it is there, and buttons to move it or take it out; the first unfinished one is
 * marked "up next". Below, anything else on the shelf can be added by title. Every change
 * is saved at once and undone on failure.
 */
import { useMemo, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { GENRE_LABELS, type Genre } from '../../lib/api/types/documents';
import { putMember, removeMember, reorderCollection } from '../../lib/collections/api';
import { problemOf } from '../common/Problem';
import styles from './Collections.module.css';
import { MemberNote } from './MemberNote';
import { moved, readHref } from './path';

export interface ShelfEntry {
  id: string;
  slug: string;
  title: string;
  authors: string[];
  genre: Genre;
}

export interface PathEntry extends ShelfEntry {
  /** 0–1 of the document read. */
  share: number;
  /** "12% read", "Finished", "Not started". */
  progress: string;
  /** Where to pick up, when reading has started. */
  resume: string | null;
  note: string | null;
}

export interface CollectionPathProps {
  collection: string;
  members: PathEntry[];
  /** Everything on the shelf, to add from. */
  shelf: ShelfEntry[];
  api?: Pick<ApiClient, 'put' | 'delete'>;
}

const MATCHES = 8;

export function CollectionPath({ collection, members: initial, shelf, api = browserApi }: CollectionPathProps) {
  const [members, setMembers] = useState(initial);
  const [find, setFind] = useState('');
  const [error, setError] = useState<string | null>(null);

  const next = members.find((m) => m.share < 1)?.id ?? null;
  const inside = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const matches = useMemo(() => {
    const words = find.trim().toLocaleLowerCase();
    if (!words) return [];
    return shelf
      .filter((d) => !inside.has(d.id) && `${d.title} ${d.authors.join(' ')}`.toLocaleLowerCase().includes(words))
      .slice(0, MATCHES);
  }, [find, shelf, inside]);

  /** Show `after` at once; put `before` back and say why if saving fails. */
  const save = async (after: PathEntry[], write: () => Promise<unknown>) => {
    const before = members;
    setMembers(after);
    setError(null);
    try {
      await write();
    } catch (problem) {
      setMembers(before);
      setError(problemOf(problem).message);
    }
  };

  const move = (index: number, delta: number) => {
    const after = moved(members, index, delta);
    void save(after, () =>
      reorderCollection(
        api,
        collection,
        after.map((m) => m.id),
      ),
    );
  };

  const remove = (id: string) => void save(members.filter((m) => m.id !== id), () => removeMember(api, collection, id));

  const add = (doc: ShelfEntry) => {
    setFind('');
    const entry: PathEntry = { ...doc, share: 0, progress: 'Not started', resume: null, note: null };
    void save([...members, entry], () => putMember(api, collection, doc.id));
  };

  const setNote = (id: string, note: string | null) =>
    save(
      members.map((m) => (m.id === id ? { ...m, note } : m)),
      () => putMember(api, collection, id, note),
    );

  return (
    <div className={styles.path}>
      {members.length === 0 ? (
        <p className={styles.quiet}>Nothing here yet. Add books, papers or articles from your shelf below.</p>
      ) : (
        <ol className={styles.members}>
          {members.map((m, index) => (
            <li key={m.id} className={styles.member} data-genre={m.genre} data-next={m.id === next ? '' : undefined}>
              <span className={styles.step} aria-hidden="true">
                {index + 1}
              </span>
              <div className={styles.body}>
                <p className={styles.kicker}>
                  <span className={styles.genre}>{GENRE_LABELS[m.genre]}</span>
                  {m.id === next && <span className={styles.nextTag}>Up next</span>}
                </p>
                <h3 className={styles.title}>
                  <a href={readHref(m.slug, collection, m.resume)}>{m.title}</a>
                </h3>
                {m.authors.length > 0 && <p className={styles.authors}>{m.authors.join(', ')}</p>}
                <div className={styles.progress}>
                  <span className={styles.bar} aria-hidden="true">
                    <span style={{ inlineSize: `${Math.round(m.share * 100)}%` }} />
                  </span>
                  <span>{m.progress}</span>
                  <a href={`/documents/${m.slug}`}>Overview</a>
                </div>
                <MemberNote note={m.note} title={m.title} onSave={(note) => setNote(m.id, note)} />
              </div>
              <div className={styles.tools} role="group" aria-label={`Arrange ${m.title}`}>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${m.title} earlier`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === members.length - 1} aria-label={`Move ${m.title} later`}>
                  ↓
                </button>
                <button type="button" onClick={() => remove(m.id)} aria-label={`Take ${m.title} out of the collection`}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className={styles.error} aria-live="polite">
        {error}
      </p>

      <div className={styles.adder}>
        <label>
          <span>Add from your shelf</span>
          <input type="search" value={find} placeholder="Find a title or author" maxLength={200} onChange={(e) => setFind(e.target.value)} />
        </label>
        {matches.length > 0 && (
          <ul className={styles.matches} aria-label="Matching documents">
            {matches.map((d) => (
              <li key={d.id} data-genre={d.genre}>
                <button type="button" onClick={() => add(d)}>
                  <span className={styles.genre}>{GENRE_LABELS[d.genre]}</span> {d.title}
                  {d.authors.length > 0 && <span className={styles.quiet}> · {d.authors.join(', ')}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {find.trim() && matches.length === 0 && <p className={styles.quiet}>Nothing else on the shelf matches “{find.trim()}”.</p>}
      </div>
    </div>
  );
}

export default CollectionPath;
