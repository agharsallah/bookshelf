/**
 * Narrow a search to some books, tags or kinds of distillation. Collapsed by default;
 * the summary says how many filters are on so a narrowed search never hides it.
 */
import type { ArtifactType } from '../../lib/api/types/artifacts';
import { TYPE_LABELS } from '../review/labels';
import type { SearchState } from './url-state';
import styles from './Search.module.css';

export interface FilterDocument {
  id: string;
  title: string;
}

/** The distillation types worth filtering search by. */
export const FILTER_TYPES: ArtifactType[] = [
  'section_note',
  'chapter_distillation',
  'chapter_summary',
  'book_brief',
  'book_summary',
  'structured_note',
  'glossary',
  'faq',
];

export interface FiltersProps {
  state: SearchState;
  documents: readonly FilterDocument[];
  tags: readonly string[];
  onChange: (patch: Partial<Pick<SearchState, 'documents' | 'tags' | 'types'>>) => void;
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function Filters({ state, documents, tags, onChange }: FiltersProps) {
  const count = state.documents.length + state.tags.length + state.types.length;
  return (
    <details className={styles.filters} open={count > 0 || undefined}>
      <summary>
        Filters{count ? <span className={styles.count}> ({count} on)</span> : null}
      </summary>
      <div className={styles.filterGrid}>
        {documents.length ? (
          <fieldset>
            <legend>Books</legend>
            {documents.map((d) => (
              <label key={d.id} className={styles.check}>
                <input type="checkbox" checked={state.documents.includes(d.id)} onChange={() => onChange({ documents: toggle(state.documents, d.id) })} />
                <span>{d.title}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {tags.length ? (
          <fieldset>
            <legend>Tags</legend>
            {tags.map((t) => (
              <label key={t} className={styles.check}>
                <input type="checkbox" checked={state.tags.includes(t)} onChange={() => onChange({ tags: toggle(state.tags, t) })} />
                <span>{t}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <fieldset>
          <legend>Distillations</legend>
          {FILTER_TYPES.map((t) => (
            <label key={t} className={styles.check}>
              <input type="checkbox" checked={state.types.includes(t)} onChange={() => onChange({ types: toggle(state.types, t) })} />
              <span>{TYPE_LABELS[t]}</span>
            </label>
          ))}
        </fieldset>
      </div>
      {count ? (
        <button type="button" className={styles.clear} onClick={() => onChange({ documents: [], tags: [], types: [] })}>
          Clear filters
        </button>
      ) : null}
    </details>
  );
}
