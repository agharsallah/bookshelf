/**
 * The lens's list of books: which documents stay in play.
 *
 * It lists only the documents of the kinds the lens keeps (turn papers off and the papers
 * leave the list), so what is ticked is what can show. "All" and "None" act on the books
 * listed; a long shelf gets a box that narrows the list by title. A book turned off stays
 * off when its kind is hidden and shown again.
 */
import { useState } from 'react';
import type { Genre } from '../../lib/api/types/documents';
import { toggle, toggleMany, type LensState } from './lens';
import type { AtlasIndex } from './model';
import styles from './Atlas.module.css';

/** From this many books on, the list gets a box to find one by title. */
export const FIND_FROM = 8;

export interface BookFilterProps {
  index: AtlasIndex;
  lens: LensState;
  onChange: (books: string[] | null) => void;
  /** The legend: "Books", or "Documents" when the shelf holds more than one kind. */
  legend: string;
}

const docId = (n: AtlasIndex['shelf'][number]) => n.document?.id ?? n.id;

export function BookFilter({ index, lens, onChange, legend }: BookFilterProps) {
  const [find, setFind] = useState('');
  const all = index.shelf.map(docId);
  const kept = (g: Genre) => lens.genres === null || lens.genres.includes(g);
  const ofKind = index.shelf.filter((b) => kept(b.genre ?? 'book'));
  const q = find.trim().toLowerCase();
  const listed = q ? ofKind.filter((b) => b.label.toLowerCase().includes(q)) : ofKind;
  const listedIds = listed.map(docId);
  const on = (id: string) => lens.books === null || lens.books.includes(id);

  return (
    <fieldset className={styles.group}>
      <legend>{legend}</legend>
      {ofKind.length >= FIND_FROM ? (
        <input
          type="search"
          className={styles.find}
          placeholder="Find by title"
          aria-label={`Find in ${legend.toLowerCase()}`}
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      ) : null}
      <p className={styles.only}>
        Select:{' '}
        <button type="button" className={styles.linkish} onClick={() => onChange(toggleMany(lens.books, listedIds, true, all))}>
          all
        </button>
        <button type="button" className={styles.linkish} onClick={() => onChange(toggleMany(lens.books, listedIds, false, all))}>
          none
        </button>
        <span className={styles.tally}>
          {listedIds.filter(on).length} of {listed.length}
        </span>
      </p>
      <div className={styles.bookList}>
        {listed.map((b) => {
          const id = docId(b);
          return (
            <label key={id} className={styles.check}>
              <input type="checkbox" checked={on(id)} onChange={() => onChange(toggle(lens.books, id, all))} />
              <span className={styles.bookName} title={b.label}>
                {b.label}
              </span>
            </label>
          );
        })}
        {listed.length === 0 ? <p className={styles.only}>{q ? 'No title matches.' : 'None of this kind.'}</p> : null}
      </div>
    </fieldset>
  );
}
