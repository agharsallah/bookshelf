/**
 * The filter bar: free text (press "/" to jump to it), state, kind and document, how many
 * jobs match, and Clear. The page keeps the filters in its URL (./filters.ts).
 */
import { useEffect, useRef } from 'react';
import { JOB_KINDS, JOB_STATES, type JobKind, type JobState } from '../../lib/api/types/jobs';
import type { DocumentLabel } from '../review/api';
import { hasFilters, type JobFilters } from './filters';
import { KIND_LABELS } from './model';
import styles from './Pipeline.module.css';

export interface PipelineFiltersProps {
  filters: JobFilters;
  onChange: (filters: JobFilters) => void;
  documents: readonly DocumentLabel[];
  matched: number;
  total: number;
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function PipelineFilters({ filters, onChange, documents, matched, total }: PipelineFiltersProps) {
  const search = useRef<HTMLInputElement>(null);
  const set = (change: JobFilters) => onChange({ ...filters, ...change });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form className={styles.filters} aria-label="Filter jobs" role="search" onSubmit={(e) => e.preventDefault()}>
      <label className={styles.search}>
        <span>
          Find <kbd className={styles.kbd}>/</kbd>
        </span>
        <input
          ref={search}
          type="search"
          value={filters.q ?? ''}
          placeholder="Book, kind, section or skill"
          onChange={(e) => set({ q: e.target.value })}
          onKeyDown={(e) => e.key === 'Escape' && set({ q: '' })}
        />
      </label>
      <label>
        <span>State</span>
        <select value={filters.state ?? ''} onChange={(e) => set({ state: e.target.value as JobState | '' })}>
          <option value="">Any state</option>
          {JOB_STATES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Kind</span>
        <select value={filters.kind ?? ''} onChange={(e) => set({ kind: e.target.value as JobKind | '' })}>
          <option value="">Any kind</option>
          {JOB_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Document</span>
        <select value={filters.document ?? ''} onChange={(e) => set({ document: e.target.value })}>
          <option value="">Every document</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.matched} aria-live="polite">
        {hasFilters(filters) ? (
          <>
            {matched} of {total} jobs
            <button type="button" className="btn btn-quiet" onClick={() => onChange({})}>
              Clear filters
            </button>
          </>
        ) : (
          `${total} jobs`
        )}
      </p>
    </form>
  );
}
