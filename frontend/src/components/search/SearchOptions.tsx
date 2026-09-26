/**
 * "Search options": the rarely needed choices, folded away. How to search (Auto by
 * default, each mode described in plain words) and the filters. The summary names what
 * differs from the defaults, and the panel opens by itself when something does, so a
 * narrowed search never hides why.
 */
import { useState } from 'react';
import type { SearchMode } from '../../lib/api/types/search';
import { FilterFields, type FilterDocument, type FilterPatch } from './Filters';
import { MODE_OPTIONS, optionsSummary } from './modes';
import type { SearchState } from './url-state';
import styles from './Query.module.css';

export interface SearchOptionsProps {
  state: SearchState;
  documents: readonly FilterDocument[];
  tags: readonly string[];
  onMode: (mode: SearchMode) => void;
  onFilters: (patch: FilterPatch) => void;
}

export function SearchOptions({ state, documents, tags, onMode, onFilters }: SearchOptionsProps) {
  const changed = optionsSummary(state);
  const filtered = state.documents.length + state.tags.length + state.types.length > 0;
  // Open on arrival when the URL already changes something; after that the reader decides.
  const [openAtFirst] = useState(() => changed !== '');
  return (
    <details className={styles.options} open={openAtFirst || undefined}>
      <summary>
        Search options{changed ? <span className={styles.changed}>{changed}</span> : null}
      </summary>
      <div className={styles.optionsBody}>
        <fieldset className={`${styles.group} ${styles.modes}`}>
          <legend>How to search</legend>
          {MODE_OPTIONS.map((m) => (
            <label key={m.mode} className={styles.mode}>
              <input type="radio" name="mode" value={m.mode} checked={state.mode === m.mode} onChange={() => onMode(m.mode)} />
              <span className={styles.modeText}>
                <span className={styles.modeLabel}>{m.label}</span>
                <span className={styles.modeWhy}>{m.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <FilterFields state={state} documents={documents} tags={tags} onChange={onFilters} />
      </div>
      {changed ? (
        <div className={styles.reset}>
          {state.mode !== 'auto' ? (
            <button type="button" className="btn btn-quiet" onClick={() => onMode('auto')}>
              Back to Auto
            </button>
          ) : null}
          {filtered ? (
            <button type="button" className="btn btn-quiet" onClick={() => onFilters({ documents: [], tags: [], types: [] })}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
