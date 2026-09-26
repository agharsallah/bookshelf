/**
 * The query box, the page's hero: one large field in the tool's voice with its Search
 * button, what the search did once results are in, and the second action, Ask for an
 * answer (a cited answer written from the passages found, which spends a model run).
 * How to search and the filters live under "Search options" (SearchOptions.tsx).
 */
import { forwardRef, type KeyboardEvent, type SubmitEvent } from 'react';
import type { Intent } from '../../lib/api/types/search';
import { INTENT_NOTES } from './modes';
import styles from './Query.module.css';

export interface QueryBarProps {
  query: string;
  intent: Intent | null;
  loading: boolean;
  asking: boolean;
  onQuery: (q: string) => void;
  onSubmit: () => void;
  onAsk: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export const QueryBar = forwardRef<HTMLInputElement, QueryBarProps>(function QueryBar(props, ref) {
  const { query, intent, loading, asking } = props;
  const blank = !query.trim();
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSubmit();
  };
  return (
    <form className={styles.queryForm} role="search" onSubmit={submit}>
      <div className={styles.field}>
        <svg className={styles.glass} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5" />
        </svg>
        <label htmlFor="search-q" className="visually-hidden">
          Search your library
        </label>
        <input
          ref={ref}
          id="search-q"
          className={styles.input}
          type="search"
          name="q"
          value={query}
          placeholder="An idea, a chapter, or a phrase"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          onChange={(e) => props.onQuery(e.target.value)}
          onKeyDown={props.onKeyDown}
        />
        <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={blank}>
          Search
        </button>
      </div>
      <div className={styles.below}>
        <p className={styles.intent} data-loading={loading || undefined} aria-live="polite">
          {intent && !blank ? (
            <>
              <span className="visually-hidden">What the search did: </span>
              {INTENT_NOTES[intent]}
            </>
          ) : (
            <span className={styles.keyHint}>
              Press <kbd>/</kbd> to come back here, <kbd>↓</kbd> to move through the results
            </span>
          )}
        </p>
        <div className={styles.ask}>
          <button type="button" className="btn" disabled={blank || asking} onClick={props.onAsk}>
            Ask for an answer
          </button>
          <span className={styles.askWhy}>A short answer written from what it finds, every claim cited</span>
        </div>
      </div>
    </form>
  );
});
