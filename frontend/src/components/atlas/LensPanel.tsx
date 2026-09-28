/**
 * The lens: filters that narrow the map to one aspect of the shelf, and highlight it.
 *
 * Connections (by type, with their mark and how many there are), the kind of document
 * (books, papers, articles, when the shelf holds more than one), kinds of thing (books,
 * chapters, and concepts by their own kind), books, "only ideas in more than one book",
 * what to do with the rest (dim or hide), and whether to group by book. Every change is
 * immediate; counts come from the whole atlas, so a filter never hides its own way back.
 */
import { GENRES, type Genre } from '../../lib/api/types/documents';
import type { ConceptKind } from '../../lib/api/types/graph';
import { KindMark, RelationMark } from '../graph/Legend';
import { LINK_KINDS, LINK_STYLES, type LinkKind } from '../graph/styles';
import { cleared, isFiltering, KIND_KEYS, toggle, type KindKey, type LensState } from './lens';
import { kindKey, type AtlasIndex } from './model';
import graph from '../graph/Graph.module.css';
import styles from './Atlas.module.css';

export interface LensPanelProps {
  index: AtlasIndex;
  lens: LensState;
  onChange: (next: LensState) => void;
  /** Workshop: queue the bridge jobs that propose cross-book relations. */
  onFindBridges?: () => void;
  /** What the last request for bridges said. */
  bridges?: string | null;
}

const KIND_LABELS: Record<KindKey, string> = {
  document: 'Books',
  chapter: 'Chapters',
  concept: 'Concepts',
  framework: 'Frameworks',
  person: 'People',
  work: 'Works',
  term: 'Terms',
  method: 'Methods',
  dataset: 'Datasets',
  metric: 'Metrics',
  task: 'Tasks',
};

const GENRE_PLURALS: Record<Genre, string> = { book: 'Books', paper: 'Papers', article: 'Articles' };

function kindMark(key: KindKey) {
  if (key === 'document') return <KindMark kind="document" />;
  if (key === 'chapter') return <KindMark kind="node" />;
  return <KindMark kind="concept" conceptKind={key} />;
}

function counts<T extends string>(values: T[]): Map<T, number> {
  const out = new Map<T, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
}

export function LensPanel({ index, lens, onChange, onFindBridges, bridges }: LensPanelProps) {
  const set = (patch: Partial<LensState>) => onChange({ ...lens, ...patch });
  const linkCounts = counts(index.atlas.edges.map((e) => e.relation));
  const links = LINK_KINDS.filter((l) => linkCounts.has(l));
  const kindCounts = counts(index.atlas.nodes.map(kindKey));
  const kinds = (KIND_KEYS as readonly KindKey[]).filter((k) => kindCounts.has(k));
  const on = <T extends string>(list: T[] | null, value: T) => list === null || list.includes(value);
  // Genres of the shelf's documents; the fieldset shows only when there is a choice.
  const genreCounts = counts(index.shelf.map((d) => d.genre ?? 'book'));
  const genres = GENRES.filter((g) => genreCounts.has(g));

  return (
    <aside className={styles.lensPanel} aria-label="Lens">
      <fieldset className={styles.group}>
        <legend>Connections</legend>
        {links.map((l: LinkKind) => (
          <label key={l} className={styles.check}>
            <input type="checkbox" checked={on(lens.links, l)} onChange={() => set({ links: toggle(lens.links, l, links) })} />
            <RelationMark relation={l} />
            <span>{LINK_STYLES[l].label}</span>
            <span className={styles.tally}>{linkCounts.get(l)}</span>
          </label>
        ))}
        <p className={styles.only}>
          Only:{' '}
          {(['supports', 'contradicts', 'shares', 'echoes', 'cites'] as const)
            .filter((l) => linkCounts.has(l))
            .map((l) => (
              <button key={l} type="button" className={styles.linkish} onClick={() => set({ links: [l] })}>
                {LINK_STYLES[l].label.toLowerCase()}
              </button>
            ))}
        </p>
      </fieldset>

      {genres.length > 1 ? (
        <fieldset className={styles.group}>
          <legend>Kind of document</legend>
          {genres.map((g) => (
            <label key={g} className={styles.check}>
              <input type="checkbox" checked={on(lens.genres, g)} onChange={() => set({ genres: toggle(lens.genres, g, genres) })} />
              <span>{GENRE_PLURALS[g]}</span>
              <span className={styles.tally}>{genreCounts.get(g)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <fieldset className={styles.group}>
        <legend>Show</legend>
        {kinds.map((k) => (
          <label key={k} className={styles.check}>
            <input type="checkbox" checked={on(lens.kinds, k)} onChange={() => set({ kinds: toggle(lens.kinds, k, kinds) })} />
            {kindMark(k)}
            <span>{k === 'document' && genres.length > 1 ? 'Documents' : KIND_LABELS[k as ConceptKind | 'document' | 'chapter']}</span>
            <span className={styles.tally}>{kindCounts.get(k)}</span>
          </label>
        ))}
        <label className={styles.check}>
          <input type="checkbox" checked={lens.crossBook} onChange={(e) => set({ crossBook: e.target.checked })} />
          <span>Only ideas in more than one book</span>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={lens.proposed} onChange={(e) => set({ proposed: e.target.checked })} />
          <span>Proposed links, waiting for you</span>
        </label>
      </fieldset>

      {onFindBridges ? (
        <div className={`${styles.group} workshop-only`}>
          <button type="button" className={graph.actionQuiet} onClick={onFindBridges}>
            Ask how the books relate
          </button>
          <p className={styles.only}>{bridges ?? 'A model reads pairs of ideas from different books and proposes how they relate.'}</p>
        </div>
      ) : null}

      {index.shelf.length > 1 ? (
        <fieldset className={styles.group}>
          <legend>Books</legend>
          {index.shelf.map((b) => {
            const id = b.document?.id ?? b.id;
            const all = index.shelf.map((x) => x.document?.id ?? x.id);
            return (
              <label key={id} className={styles.check}>
                <input type="checkbox" checked={on(lens.books, id)} onChange={() => set({ books: toggle(lens.books, id, all) })} />
                <span className={styles.bookName}>{b.label}</span>
              </label>
            );
          })}
        </fieldset>
      ) : null}

      <fieldset className={graph.segmented}>
        <legend>The rest</legend>
        {(['dim', 'hide'] as const).map((o) => (
          <label key={o}>
            <input type="radio" name="others" checked={lens.others === o} onChange={() => set({ others: o })} />
            <span>{o === 'dim' ? 'Dim' : 'Hide'}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className={graph.segmented}>
        <legend>Layout</legend>
        {(['free', 'book'] as const).map((g) => (
          <label key={g}>
            <input type="radio" name="group" checked={lens.group === g} onChange={() => set({ group: g })} />
            <span>{g === 'free' ? 'Free' : 'By book'}</span>
          </label>
        ))}
      </fieldset>

      {isFiltering(lens) || lens.query ? (
        <button type="button" className={graph.actionQuiet} onClick={() => onChange(cleared(lens))}>
          Clear the lens
        </button>
      ) : null}
    </aside>
  );
}
