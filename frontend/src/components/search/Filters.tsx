/**
 * Narrow a search to some books, tags or kinds of distillation: the filter fieldsets
 * shown inside "Search options" (SearchOptions.tsx), which says how many are on.
 */
import type { ArtifactType } from '../../lib/api/types/artifacts';
import { TYPE_LABELS } from '../review/labels';
import type { SearchState } from './url-state';
import styles from './Query.module.css';

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
  'book_guide',
  'book_summary',
  'structured_note',
  'glossary',
  'faq',
];

export type FilterPatch = Partial<Pick<SearchState, 'documents' | 'tags' | 'types'>>;

export interface FilterFieldsProps {
  state: SearchState;
  documents: readonly FilterDocument[];
  tags: readonly string[];
  onChange: (patch: FilterPatch) => void;
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterFields({ state, documents, tags, onChange }: FilterFieldsProps) {
  return (
    <>
      {documents.length ? (
        <fieldset className={styles.group}>
          <legend>Books</legend>
          <div className={styles.checks}>
            {documents.map((d) => (
              <label key={d.id} className={styles.check}>
                <input type="checkbox" checked={state.documents.includes(d.id)} onChange={() => onChange({ documents: toggle(state.documents, d.id) })} />
                <span className="book-title">{d.title}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {tags.length ? (
        <fieldset className={styles.group}>
          <legend>Tags</legend>
          <div className={styles.checks}>
            {tags.map((t) => (
              <label key={t} className={styles.check}>
                <input type="checkbox" checked={state.tags.includes(t)} onChange={() => onChange({ tags: toggle(state.tags, t) })} />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset className={styles.group}>
        <legend>Kinds of distillation</legend>
        <div className={styles.checks}>
          {FILTER_TYPES.map((t) => (
            <label key={t} className={styles.check}>
              <input type="checkbox" checked={state.types.includes(t)} onChange={() => onChange({ types: toggle(state.types, t) })} />
              <span>{TYPE_LABELS[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
