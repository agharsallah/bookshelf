/**
 * The library side by side: each book's size, how long its first end-to-end pass took,
 * what it cost in tokens and time, normalized per page and per 1k words so books of any
 * length compare, and how much of its work failed. A row opens the book's own stats.
 * Most recently active first; any column sorts.
 */
import type { BookRow } from '../../lib/api/types/stats';
import { formatCount, formatDuration, formatNumber, formatPercent, formatUsd, NONE } from './format';
import { share } from './model';
import { StatsTable, type StatsColumn } from './StatsTable';
import styles from './Stats.module.css';

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

const time = (iso: string | null) => (iso ? Date.parse(iso) : null);

/** Two authors in full, more as the first and "et al." (a paper can list a dozen). */
const byline = (authors: readonly string[]) => (authors.length > 2 ? `${authors[0]} et al.` : authors.join(', '));

function columns(max: number): StatsColumn<BookRow>[] {
  return [
    {
      key: 'book',
      label: 'Book',
      value: (r) => r.book.title,
      cellClass: () => styles.wrap,
      cell: (r) => (
        <>
          <a href={`/pipeline/stats/${r.book.slug}`}>{r.book.title}</a>
          <span className={styles.sub}>{[byline(r.book.authors), r.book.kind.toUpperCase(), r.book.status].filter(Boolean).join(' · ')}</span>
        </>
      ),
    },
    { key: 'pages', label: 'Pages', numeric: true, value: (r) => r.book.pages, cell: (r) => r.book.pages ?? NONE },
    { key: 'words', label: 'Words', numeric: true, value: (r) => r.book.words, cell: (r) => formatCount(r.book.words) },
    { key: 'chapters', label: 'Chapters', numeric: true, value: (r) => r.book.chapters, cell: (r) => r.book.chapters },
    {
      key: 'e2e',
      label: 'End to end',
      numeric: true,
      title: 'Wall clock of the first pass that parsed the book',
      value: (r) => r.end_to_end_ms,
      cell: (r) => formatDuration(r.end_to_end_ms),
    },
    { key: 'compute', label: 'Compute', numeric: true, title: 'Sum of job run times', value: (r) => r.time.compute_ms, cell: (r) => formatDuration(r.time.compute_ms) },
    {
      key: 'tokens',
      label: 'Tokens',
      firstDir: 'desc',
      value: (r) => r.tokens.tokens,
      cell: (r) => (
        <span className={styles.barCell}>
          <span className={styles.track} aria-hidden="true">
            <span className={styles.fill} style={{ inlineSize: `${share(r.tokens.tokens, max)}%` }} />
          </span>
          <span className={styles.num}>{formatCount(r.tokens.tokens)}</span>
        </span>
      ),
    },
    {
      key: 'tokens_per_1k',
      label: 'Tokens / 1k words',
      numeric: true,
      value: (r) => r.efficiency.tokens_per_1k_words,
      cell: (r) => formatCount(r.efficiency.tokens_per_1k_words),
    },
    {
      key: 'minutes_per_10k',
      label: 'min / 10k words',
      numeric: true,
      value: (r) => r.efficiency.minutes_per_10k_words,
      cell: (r) => formatNumber(r.efficiency.minutes_per_10k_words),
    },
    {
      key: 'failed',
      label: 'Failed',
      numeric: true,
      value: (r) => r.failure_rate,
      cellClass: (r) => ((r.failure_rate ?? 0) >= 0.1 ? styles.warn : undefined),
      cell: (r) => formatPercent(r.failure_rate),
    },
    { key: 'cost', label: 'Cost', numeric: true, value: (r) => r.tokens.cost_usd, cell: (r) => formatUsd(r.tokens.cost_usd) },
    {
      key: 'last',
      label: 'Last run',
      numeric: true,
      title: 'When its last job finished',
      value: (r) => time(r.last_activity),
      cell: (r) => (r.last_activity ? day.format(new Date(r.last_activity)) : NONE),
    },
    {
      key: 'left',
      label: 'Left',
      numeric: true,
      title: 'Jobs queued or running',
      value: (r) => r.remaining.queued + r.remaining.running,
      cell: (r) => (
        <>
          {r.remaining.queued + r.remaining.running || NONE}
          {r.remaining.eta_ms ? <span className={styles.sub}>~{formatDuration(r.remaining.eta_ms)}</span> : null}
        </>
      ),
    },
  ];
}

export function BookTable({ books, pageSize = 15 }: { books: readonly BookRow[]; pageSize?: number }) {
  if (books.length === 0) return <p className={styles.empty}>No book has been ingested yet.</p>;
  const max = Math.max(0, ...books.map((b) => b.tokens.tokens));
  return <StatsTable rows={books} columns={columns(max)} rowKey={(r) => r.book.id} noun="books" label="Books" pageSize={pageSize} />;
}
