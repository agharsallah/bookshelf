/**
 * The end of a session: what it held (seen, saved, correct of answered, due tomorrow,
 * minutes) and where to go next — continue reading, another round, or back to Today.
 */
import type { SessionSummary } from '../../lib/pills/types';
import { readerHref } from '../search/links';
import styles from './EndCard.module.css';

export interface EndCardProps {
  summary: SessionSummary | null;
  /** The finish failed: say so, and offer to try again. */
  error: string | null;
  onRetry: () => void;
  onAgain: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function EndCard({ summary, error, onRetry, onAgain }: EndCardProps) {
  if (!summary) {
    return (
      <section className={styles.end} aria-labelledby="pills-end-title" aria-busy={!error}>
        <h2 id="pills-end-title">{error ? 'The session could not be closed' : 'Adding it up…'}</h2>
        {error ? (
          <>
            <p className={styles.lede}>{error}</p>
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : null}
      </section>
    );
  }
  const { seen, saved, answered, correct, due_tomorrow, minutes, next_read } = summary;
  const stats: { value: string; label: string }[] = [
    { value: String(seen), label: 'seen' },
    { value: String(saved), label: 'saved' },
    { value: answered > 0 ? `${correct}/${answered}` : '—', label: 'answered right' },
    { value: String(due_tomorrow), label: 'due tomorrow' },
    { value: String(Math.max(0, Math.round(minutes))), label: minutes === 1 ? 'minute' : 'minutes' },
  ];
  return (
    <section className={styles.end} aria-labelledby="pills-end-title">
      <h2 id="pills-end-title">That’s the session</h2>
      <p className={styles.lede}>
        {seen === 0 ? 'Nothing shown this time.' : `${plural(seen, 'idea')} in ${plural(Math.max(1, Math.round(minutes)), 'minute')}.`}
        {saved > 0 ? ` What you saved comes back for review.` : ''}
      </p>
      <dl className={styles.stats}>
        {stats.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.actions}>
        {next_read ? (
          <a className={`btn btn-primary ${styles.continue}`} href={readerHref(next_read.document.slug, next_read.anchor)}>
            Continue reading <span className={styles.where}>{next_read.title ?? next_read.document.title}</span>
          </a>
        ) : null}
        <button type="button" className={next_read ? 'btn' : 'btn btn-primary'} onClick={onAgain}>
          Another round
        </button>
        <a className="btn btn-quiet" href="/">
          Back to Today
        </a>
      </div>
    </section>
  );
}
