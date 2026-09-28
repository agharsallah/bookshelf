/**
 * The library side by side: each book's size, how long its first end-to-end pass took,
 * what it cost in tokens and time, normalized per page and per 1k words so books of any
 * length compare, and how much of its work failed. A row opens the book's own stats.
 */
import type { BookRow } from '../../lib/api/types/stats';
import { formatCount, formatDuration, formatNumber, formatPercent, formatUsd, NONE } from './format';
import { share } from './model';
import styles from './Stats.module.css';

export function BookTable({ books }: { books: readonly BookRow[] }) {
  if (books.length === 0) return <p className={styles.empty}>No book has been ingested yet.</p>;
  const max = Math.max(0, ...books.map((b) => b.tokens.tokens));
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Book</th>
            <th scope="col" className={styles.num}>Pages</th>
            <th scope="col" className={styles.num}>Words</th>
            <th scope="col" className={styles.num}>Chapters</th>
            <th scope="col" className={styles.num}>End to end</th>
            <th scope="col" className={styles.num}>Compute</th>
            <th scope="col">Tokens</th>
            <th scope="col" className={styles.num}>Tokens / 1k words</th>
            <th scope="col" className={styles.num}>min / 10k words</th>
            <th scope="col" className={styles.num}>Failed</th>
            <th scope="col" className={styles.num}>Cost</th>
            <th scope="col" className={styles.num}>Left</th>
          </tr>
        </thead>
        <tbody>
          {books.map((row) => (
            <tr key={row.book.id}>
              <th scope="row" className={styles.wrap}>
                <a href={`/pipeline/stats/${row.book.slug}`}>{row.book.title}</a>
                <span className={styles.sub}>
                  {[row.book.authors.join(', '), row.book.kind.toUpperCase(), row.book.status].filter(Boolean).join(' · ')}
                </span>
              </th>
              <td className={styles.num}>{row.book.pages ?? NONE}</td>
              <td className={styles.num}>{formatCount(row.book.words)}</td>
              <td className={styles.num}>{row.book.chapters}</td>
              <td className={styles.num}>{formatDuration(row.end_to_end_ms)}</td>
              <td className={styles.num}>{formatDuration(row.time.compute_ms)}</td>
              <td>
                <span className={styles.barCell}>
                  <span className={styles.track} aria-hidden="true">
                    <span className={styles.fill} style={{ inlineSize: `${share(row.tokens.tokens, max)}%` }} />
                  </span>
                  <span className={styles.num}>{formatCount(row.tokens.tokens)}</span>
                </span>
              </td>
              <td className={styles.num}>{formatCount(row.efficiency.tokens_per_1k_words)}</td>
              <td className={styles.num}>{formatNumber(row.efficiency.minutes_per_10k_words)}</td>
              <td className={`${styles.num} ${(row.failure_rate ?? 0) >= 0.1 ? styles.warn : ''}`}>{formatPercent(row.failure_rate)}</td>
              <td className={styles.num}>{formatUsd(row.tokens.cost_usd)}</td>
              <td className={styles.num}>
                {row.remaining.queued + row.remaining.running || NONE}
                {row.remaining.eta_ms ? <span className={styles.sub}>~{formatDuration(row.remaining.eta_ms)}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
