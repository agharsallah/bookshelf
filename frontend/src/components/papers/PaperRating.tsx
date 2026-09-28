/**
 * Your rating of the paper (docs/PAPERS.md P8): stars, an optional verdict and a note.
 * Saving appends a rating (`POST /papers/{ref}/ratings`) that supersedes the last; the
 * earlier ones stay listed under it. It is yours and sits apart from the model's
 * assessment, which never feeds it.
 */
import { useId, useReducer, useState, type SubmitEvent } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { PAPER_VERDICTS, type PaperRatingPublic } from '../../lib/api/types/papers';
import { ratePaper } from '../../lib/papers/api';
import { problemOf } from '../common/Problem';
import { starsLabel, VERDICT_LABELS } from './labels';
import { canSave, initialRating, isChanged, ratingBody, ratingReducer } from './rating';
import styles from './PaperControls.module.css';

export interface PaperRatingProps {
  paperRef: string;
  /** Every rating, newest first. */
  history: PaperRatingPublic[];
  api?: Pick<ApiClient, 'post' | 'put' | 'patch' | 'delete'>;
}

const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function Stars({ stars }: { stars: number }) {
  return (
    <span className={styles.starsShown} role="img" aria-label={starsLabel(stars)}>
      {'★'.repeat(stars)}
      <span className={styles.starsOff}>{'★'.repeat(5 - stars)}</span>
    </span>
  );
}

export function PaperRating({ paperRef, history, api = browserApi }: PaperRatingProps) {
  const [state, dispatch] = useReducer(ratingReducer, history, initialRating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const latest = state.history[0] ?? null;
  const earlier = state.history.slice(1);

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = ratingBody(state);
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      dispatch({ type: 'saved', rating: await ratePaper(api, paperRef, body) });
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.rating} onSubmit={(event) => void save(event)} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.controlTitle}>
        Your rating
      </h2>
      <fieldset className={styles.stars}>
        <legend className="visually-hidden">Stars</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={styles.star} data-on={state.stars !== null && n <= state.stars ? '' : undefined} title={starsLabel(n)}>
            <input
              type="radio"
              name={`${id}-stars`}
              value={n}
              checked={state.stars === n}
              onChange={() => dispatch({ type: 'stars', stars: n })}
            />
            <span aria-hidden="true">★</span>
            <span className="visually-hidden">{starsLabel(n)}</span>
          </label>
        ))}
      </fieldset>
      <div className={styles.verdicts} role="group" aria-label="Verdict">
        {PAPER_VERDICTS.map((verdict) => (
          <button
            key={verdict}
            type="button"
            className={styles.verdict}
            data-verdict={verdict}
            aria-pressed={state.verdict === verdict}
            onClick={() => dispatch({ type: 'verdict', verdict })}
          >
            {VERDICT_LABELS[verdict]}
          </button>
        ))}
      </div>
      <label className={styles.noteField}>
        <span className="visually-hidden">Note</span>
        <textarea
          rows={2}
          maxLength={20000}
          placeholder={latest ? 'What changed your mind? (optional)' : 'Why? (optional)'}
          value={state.note}
          onChange={(event) => dispatch({ type: 'note', note: event.target.value })}
        />
      </label>
      <div className={styles.formRow}>
        <button type="submit" className="btn btn-primary" disabled={!canSave(state) || saving}>
          {saving ? 'Saving…' : latest ? 'Save new rating' : 'Save rating'}
        </button>
        {isChanged(state) && latest ? (
          <button type="button" className="btn btn-quiet" onClick={() => dispatch({ type: 'reset' })}>
            Keep {starsLabel(latest.stars)}
          </button>
        ) : null}
        <span className={styles.formStatus} aria-live="polite">
          {error ? <span className={styles.error}>Not saved: {error}</span> : latest ? `Rated ${dateOf(latest.created_at)}` : 'Not rated yet'}
        </span>
      </div>
      {latest?.note ? <p className={styles.lastNote}>“{latest.note}”</p> : null}
      {earlier.length > 0 ? (
        <details className={styles.history}>
          <summary>Earlier ratings ({earlier.length})</summary>
          <ol>
            {earlier.map((r) => (
              <li key={r.id}>
                <Stars stars={r.stars} />
                {r.verdict ? <span className={styles.historyVerdict}>{VERDICT_LABELS[r.verdict]}</span> : null}
                <time dateTime={r.created_at}>{dateOf(r.created_at)}</time>
                {r.note ? <p>{r.note}</p> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </form>
  );
}

export default PaperRating;
