/**
 * The query line: one ruled line to write the question on, the intent the router chose
 * at its end, the mode switch beneath, and the two actions: search (instant, free) and
 * ask (a cited answer, which spends a model run).
 */
import { forwardRef, type SubmitEvent, type KeyboardEvent } from 'react';
import type { Intent, SearchMode } from '../../lib/api/types/search';
import styles from './Search.module.css';

export const INTENT_LABELS: Record<Intent, { label: string; description: string }> = {
  addressed: { label: 'Addressed', description: 'Went straight to the chapter you named.' },
  discovery: { label: 'Discovery', description: 'Searched your distillations first, then the passages behind them.' },
  synthesis: { label: 'Synthesis', description: 'Gathered what several books say, for comparison.' },
  lexical: { label: 'Lexical', description: 'Matched the exact words in the source text.' },
};

const MODES: { mode: SearchMode; label: string }[] = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'addressed', label: 'Addressed' },
  { mode: 'discovery', label: 'Discovery' },
  { mode: 'synthesis', label: 'Synthesis' },
  { mode: 'lexical', label: 'Lexical' },
];

export interface QueryBarProps {
  query: string;
  mode: SearchMode;
  intent: Intent | null;
  loading: boolean;
  asking: boolean;
  onQuery: (q: string) => void;
  onMode: (mode: SearchMode) => void;
  onSubmit: () => void;
  onAsk: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export const QueryBar = forwardRef<HTMLInputElement, QueryBarProps>(function QueryBar(props, ref) {
  const { query, mode, intent, loading, asking } = props;
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSubmit();
  };
  const shown = intent ? INTENT_LABELS[intent] : null;
  return (
    <form className={styles.queryForm} role="search" onSubmit={submit}>
      <div className={styles.line}>
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
          placeholder="What do you want to find?"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          onChange={(e) => props.onQuery(e.target.value)}
          onKeyDown={props.onKeyDown}
        />
        <span className={styles.intent} data-loading={loading || undefined} aria-live="polite">
          {shown ? (
            <>
              <span className="visually-hidden">Intent: </span>
              <span className={styles.intentLabel}>{shown.label}</span>
              <span className={styles.intentWhy}>{shown.description}</span>
            </>
          ) : null}
        </span>
      </div>
      <div className={styles.controls}>
        <fieldset className={styles.modes}>
          <legend className="visually-hidden">Search mode</legend>
          {MODES.map((m) => (
            <label key={m.mode} className={styles.mode}>
              <input type="radio" name="mode" value={m.mode} checked={mode === m.mode} onChange={() => props.onMode(m.mode)} />
              <span>{m.label}</span>
            </label>
          ))}
        </fieldset>
        <div className={styles.buttons}>
          <button type="submit" className={styles.primary} disabled={!query.trim()}>
            Search
          </button>
          <button type="button" className={styles.secondary} disabled={!query.trim() || asking} onClick={props.onAsk}>
            Ask for an answer
          </button>
        </div>
      </div>
    </form>
  );
});
