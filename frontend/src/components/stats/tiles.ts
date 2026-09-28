/**
 * The headline figures of each stats page, chosen once here: what a book (or the whole
 * library) took end to end, what it cost, how busy the pipeline was, and what is left.
 */
import type { DocumentStats, LibraryStats, TokenTotals } from '../../lib/api/types/stats';
import { formatCount, formatDuration, formatNumber, formatPercent, formatUsd } from './format';
import type { Tile } from './StatTiles';

function cacheNote(tokens: TokenTotals): string {
  if (!tokens.tracked_calls) return 'input + output · cache tracked from the next runs';
  const cached = (tokens.cache_read_tokens ?? 0) + (tokens.cache_write_tokens ?? 0);
  return `input + output · ${formatCount(cached)} more via prompt cache`;
}

function costTile(tokens: TokenTotals): Tile {
  return {
    label: 'Cost reported',
    value: formatUsd(tokens.cost_usd),
    note: tokens.tracked_calls ? `over ${tokens.tracked_calls} tracked calls` : 'no tracked calls yet',
  };
}

export function bookTiles(stats: DocumentStats): Tile[] {
  const { book, time, tokens, efficiency, remaining, jobs } = stats;
  const e2e = stats.end_to_end;
  return [
    { label: 'End to end', value: formatDuration(e2e?.wall_ms), note: e2e ? `first pass · ${e2e.jobs} jobs` : 'not run yet' },
    { label: 'Compute', value: formatDuration(time.compute_ms), note: `busy ${formatDuration(time.active_ms)} · ${formatNumber(time.parallelism)}× parallel` },
    { label: 'Tokens', value: formatCount(tokens.tokens), note: cacheNote(tokens) },
    costTile(tokens),
    {
      label: 'Per 1k words',
      value: formatCount(efficiency.tokens_per_1k_words),
      note: `tokens · ${formatNumber(efficiency.minutes_per_10k_words)} min per 10k words`,
    },
    {
      label: 'Per page',
      value: book.pages ? `${formatNumber(efficiency.seconds_per_page)} s` : '—',
      note: book.pages ? `${formatCount(efficiency.tokens_per_page)} tokens` : 'no page numbers (EPUB)',
    },
    { label: 'Jobs', value: formatCount(jobs.total), note: `${jobs.done} done · ${jobs.failed} failed · ${jobs.skipped} cached` },
    {
      label: 'Wasted',
      value: formatCount(tokens.wasted_tokens),
      note: 'tokens on attempts that produced nothing',
    },
    {
      label: 'Left',
      value: formatCount(remaining.queued + remaining.running),
      note: remaining.eta_ms ? `about ${formatDuration(remaining.eta_ms)} to go` : 'nothing queued',
    },
  ];
}

export function libraryTiles(stats: LibraryStats): Tile[] {
  const { books, tokens, time, jobs } = stats;
  const e2e = books.map((b) => b.end_to_end_ms).filter((ms): ms is number => ms !== null);
  const words = books.reduce((sum, b) => sum + b.book.words, 0);
  return [
    { label: 'Books', value: formatCount(books.length), note: `${formatCount(words)} words` },
    { label: 'Tokens', value: formatCount(tokens.tokens), note: cacheNote(tokens) },
    costTile(tokens),
    { label: 'Compute', value: formatDuration(time.compute_ms), note: `busy ${formatDuration(time.active_ms)}` },
    {
      label: 'Typical end to end',
      value: formatDuration(e2e.length ? [...e2e].sort((a, b) => a - b)[Math.floor(e2e.length / 2)] : null),
      note: 'median first pass per book',
    },
    { label: 'Jobs', value: formatCount(jobs.total), note: `${formatPercent(jobs.done + jobs.failed ? jobs.failed / (jobs.done + jobs.failed) : null)} failed` },
  ];
}
