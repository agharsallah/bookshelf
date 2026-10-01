/**
 * The lens's list of books: which documents stay in play.
 *
 * It lists only the documents of the kinds the lens keeps (turn papers off and the papers
 * leave the list), so what is ticked is what can show. A list that mixes kinds is split
 * into one section per kind (books, papers, articles), each with its own "all" and "none".
 *
 * - "all" and "none" act on the documents listed; with a title typed in the find box,
 *   "only these" keeps the matches and turns the rest of the list off;
 * - each row has an "only" that keeps that one document alone;
 * - a long shelf gets a box that narrows the list by title (Escape clears it), and the
 *   match is marked in each title.
 *
 * A book turned off stays off when its kind is hidden and shown again.
 */
import { useState } from 'react';
import { GENRE_PLURALS, GENRES, type Genre } from '../../lib/api/types/documents';
import { keepOnly, toggle, toggleMany, type LensState } from './lens';
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

type Doc = AtlasIndex['shelf'][number];

const docId = (n: Doc) => n.document?.id ?? n.id;
// A document without a genre (an older server) is a book, the default.
const genreOf = (n: Doc): Genre => n.genre ?? 'book';

/** The title, with the first match of `q` marked. */
function Title({ text, q }: { text: string; q: string }) {
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className={styles.hit}>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

export function BookFilter({ index, lens, onChange, legend }: BookFilterProps) {
  const [find, setFind] = useState('');
  const all = index.shelf.map(docId);
  const kept = (g: Genre) => lens.genres === null || lens.genres.includes(g);
  const ofKind = index.shelf.filter((b) => kept(genreOf(b)));
  const ofKindIds = ofKind.map(docId);
  const q = find.trim().toLowerCase();
  const listed = q ? ofKind.filter((b) => b.label.toLowerCase().includes(q)) : ofKind;
  const listedIds = listed.map(docId);
  const on = (id: string) => lens.books === null || lens.books.includes(id);
  const tick = (ids: readonly string[], turnOn: boolean) => onChange(toggleMany(lens.books, ids, turnOn, all));
  const only = (ids: readonly string[]) => onChange(keepOnly(lens.books, ids, ofKindIds, all));

  const sections = GENRES.map((genre) => ({ genre, docs: listed.filter((b) => genreOf(b) === genre) })).filter((s) => s.docs.length > 0);
  const grouped = sections.length > 1;

  const row = (b: Doc) => {
    const id = docId(b);
    return (
      <div key={id} className={styles.bookRow}>
        <label className={styles.check}>
          <input type="checkbox" checked={on(id)} onChange={() => onChange(toggle(lens.books, id, all))} />
          <span className={styles.bookName} title={b.label}>
            <Title text={b.label} q={q} />
          </span>
        </label>
        <button type="button" className={`${styles.linkish} ${styles.solo}`} aria-label={`Only ${b.label}`} onClick={() => only([id])}>
          only
        </button>
      </div>
    );
  };

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
          onKeyDown={(e) => {
            if (e.key === 'Escape' && find) {
              e.preventDefault();
              setFind('');
            }
          }}
        />
      ) : null}
      <p className={styles.only}>
        Select:{' '}
        <button type="button" className={styles.linkish} onClick={() => tick(listedIds, true)}>
          all
        </button>
        <button type="button" className={styles.linkish} onClick={() => tick(listedIds, false)}>
          none
        </button>
        {q && listed.length > 0 ? (
          <button type="button" className={styles.linkish} onClick={() => only(listedIds)}>
            only these
          </button>
        ) : null}
        <span className={styles.tally}>
          {listedIds.filter(on).length} of {listed.length}
        </span>
      </p>
      <div className={styles.bookList}>
        {grouped
          ? sections.map(({ genre, docs }) => {
              const ids = docs.map(docId);
              const name = GENRE_PLURALS[genre];
              return (
                <section key={genre} className={styles.bookSection} aria-label={name}>
                  <h4 className={styles.bookSectionHead}>
                    <span>{name}</span>
                    <button type="button" className={styles.linkish} aria-label={`All ${name.toLowerCase()}`} onClick={() => tick(ids, true)}>
                      all
                    </button>
                    <button type="button" className={styles.linkish} aria-label={`No ${name.toLowerCase()}`} onClick={() => tick(ids, false)}>
                      none
                    </button>
                    <span className={styles.tally}>
                      {ids.filter(on).length} of {ids.length}
                    </span>
                  </h4>
                  {docs.map(row)}
                </section>
              );
            })
          : listed.map(row)}
        {listed.length === 0 ? <p className={styles.only}>{q ? 'No title matches.' : 'None of this kind.'}</p> : null}
      </div>
    </fieldset>
  );
}
