/**
 * Chapter by chapter: size, what it cost (tokens, and time split into fixed groups on
 * one scale), cost per word and time per page (the outliers insights point at), and
 * how its outputs scored. In reading order until a column is sorted.
 */
import type { CSSProperties } from 'react';
import type { ChapterStats } from '../../lib/api/types/stats';
import { formatCount, formatDuration, formatNumber, formatPercent, NONE } from './format';
import { share, TIME_GROUPS, timeParts } from './model';
import { StatsTable, type StatsColumn } from './StatsTable';
import styles from './Stats.module.css';

export function TimeLegend() {
  return (
    <ul className={styles.legend} aria-label="Time groups">
      {TIME_GROUPS.map((g) => (
        <li key={g.key}>
          <span className={styles.swatch} style={{ '--fill': g.series } as CSSProperties} aria-hidden="true" />
          {g.label}
        </li>
      ))}
    </ul>
  );
}

const split = (c: ChapterStats) =>
  timeParts(c.ms_by_kind)
    .map((p) => `${p.label} ${formatDuration(p.ms)}`)
    .join(', ');

function columns(maxTokens: number, maxMs: number): StatsColumn<ChapterStats>[] {
  return [
    {
      key: 'chapter',
      label: 'Chapter',
      value: (c) => c.ordinal,
      cellClass: () => styles.wrap,
      cell: (c) => (
        <>
          {c.title ?? c.anchor}
          <span className={styles.sub}>
            {c.anchor} · {c.sections} sections · {c.elements} figures &amp; tables
          </span>
        </>
      ),
    },
    { key: 'pages', label: 'Pages', numeric: true, value: (c) => c.pages, cell: (c) => c.pages ?? NONE },
    { key: 'words', label: 'Words', numeric: true, value: (c) => c.words, cell: (c) => formatCount(c.words) },
    {
      key: 'jobs',
      label: 'Jobs',
      numeric: true,
      value: (c) => c.jobs.total,
      cell: (c) => (
        <>
          {c.jobs.total}
          {c.jobs.failed ? <span className={`${styles.sub} ${styles.warn}`}>{c.jobs.failed} failed</span> : null}
        </>
      ),
    },
    {
      key: 'tokens',
      label: 'Tokens',
      firstDir: 'desc',
      value: (c) => c.tokens,
      cell: (c) => (
        <span className={styles.barCell}>
          <span className={styles.track} aria-hidden="true">
            {c.tokens > 0 ? <span className={styles.fill} style={{ inlineSize: `${share(c.tokens, maxTokens)}%` }} /> : null}
          </span>
          <span className={styles.num}>{formatCount(c.tokens)}</span>
        </span>
      ),
    },
    {
      key: 'compute',
      label: 'Compute time',
      firstDir: 'desc',
      value: (c) => c.compute_ms,
      cellTitle: (c) => split(c) || undefined,
      cell: (c) => {
        const text = split(c);
        return (
          <>
            <span className={styles.barCell}>
              <span className={styles.track} aria-hidden="true">
                {timeParts(c.ms_by_kind).map((p) => (
                  <span key={p.key} className={styles.fill} style={{ inlineSize: `${share(p.ms, maxMs)}%`, '--fill': p.series } as CSSProperties} />
                ))}
              </span>
              <span className={styles.num}>{c.compute_ms ? formatDuration(c.compute_ms) : NONE}</span>
            </span>
            {text ? <span className="visually-hidden">{text}</span> : null}
          </>
        );
      },
    },
    {
      key: 'tokens_per_1k',
      label: 'Tokens / 1k words',
      numeric: true,
      value: (c) => (c.tokens ? c.tokens_per_1k_words : null),
      cell: (c) => (c.tokens ? formatCount(c.tokens_per_1k_words) : NONE),
    },
    {
      key: 'seconds_per_page',
      label: 's / page',
      numeric: true,
      value: (c) => (c.compute_ms ? c.seconds_per_page : null),
      cell: (c) => (c.compute_ms ? formatNumber(c.seconds_per_page) : NONE),
    },
    { key: 'grounding', label: 'Grounding', numeric: true, value: (c) => c.grounding, cell: (c) => formatPercent(c.grounding) },
    { key: 'flagged', label: 'Flagged', numeric: true, value: (c) => c.needs_review, cell: (c) => c.needs_review || NONE },
  ];
}

export function ChapterTable({ chapters, pageSize = 20 }: { chapters: readonly ChapterStats[]; pageSize?: number }) {
  if (chapters.length === 0) return <p className={styles.empty}>This book has no chapters yet.</p>;
  const maxTokens = Math.max(0, ...chapters.map((c) => c.tokens));
  const maxMs = Math.max(0, ...chapters.map((c) => c.compute_ms));
  return (
    <>
      <TimeLegend />
      <StatsTable rows={chapters} columns={columns(maxTokens, maxMs)} rowKey={(c) => c.anchor} noun="chapters" label="Chapters" pageSize={pageSize} />
    </>
  );
}
