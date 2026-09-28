/**
 * Chapter by chapter: size, what it cost (tokens, and time split into fixed groups on
 * one scale), cost per word and time per page (the outliers insights point at), and
 * how its outputs scored.
 */
import type { CSSProperties } from 'react';
import type { ChapterStats } from '../../lib/api/types/stats';
import { formatCount, formatDuration, formatNumber, formatPercent, NONE } from './format';
import { share, TIME_GROUPS, timeParts } from './model';
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

export function ChapterTable({ chapters }: { chapters: readonly ChapterStats[] }) {
  if (chapters.length === 0) return <p className={styles.empty}>This book has no chapters yet.</p>;
  const maxTokens = Math.max(0, ...chapters.map((c) => c.tokens));
  const maxMs = Math.max(0, ...chapters.map((c) => c.compute_ms));
  return (
    <>
      <TimeLegend />
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Chapter</th>
              <th scope="col" className={styles.num}>Pages</th>
              <th scope="col" className={styles.num}>Words</th>
              <th scope="col" className={styles.num}>Jobs</th>
              <th scope="col">Tokens</th>
              <th scope="col">Compute time</th>
              <th scope="col" className={styles.num}>Tokens / 1k words</th>
              <th scope="col" className={styles.num}>s / page</th>
              <th scope="col" className={styles.num}>Grounding</th>
              <th scope="col" className={styles.num}>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((c) => {
              const parts = timeParts(c.ms_by_kind);
              const split = parts.map((p) => `${p.label} ${formatDuration(p.ms)}`).join(', ');
              return (
                <tr key={c.anchor}>
                  <th scope="row" className={styles.wrap}>
                    {c.title ?? c.anchor}
                    <span className={styles.sub}>
                      {c.anchor} · {c.sections} sections · {c.elements} figures &amp; tables
                    </span>
                  </th>
                  <td className={styles.num}>{c.pages ?? NONE}</td>
                  <td className={styles.num}>{formatCount(c.words)}</td>
                  <td className={styles.num}>
                    {c.jobs.total}
                    {c.jobs.failed ? <span className={`${styles.sub} ${styles.warn}`}>{c.jobs.failed} failed</span> : null}
                  </td>
                  <td>
                    <span className={styles.barCell}>
                      <span className={styles.track} aria-hidden="true">
                        {c.tokens > 0 ? <span className={styles.fill} style={{ inlineSize: `${share(c.tokens, maxTokens)}%` }} /> : null}
                      </span>
                      <span className={styles.num}>{formatCount(c.tokens)}</span>
                    </span>
                  </td>
                  <td title={split || undefined}>
                    <span className={styles.barCell}>
                      <span className={styles.track} aria-hidden="true">
                        {parts.map((p) => (
                          <span key={p.key} className={styles.fill} style={{ inlineSize: `${share(p.ms, maxMs)}%`, '--fill': p.series } as CSSProperties} />
                        ))}
                      </span>
                      <span className={styles.num}>{c.compute_ms ? formatDuration(c.compute_ms) : NONE}</span>
                    </span>
                    {split ? <span className="visually-hidden">{split}</span> : null}
                  </td>
                  <td className={styles.num}>{c.tokens ? formatCount(c.tokens_per_1k_words) : NONE}</td>
                  <td className={styles.num}>{c.compute_ms ? formatNumber(c.seconds_per_page) : NONE}</td>
                  <td className={styles.num}>{formatPercent(c.grounding)}</td>
                  <td className={styles.num}>{c.needs_review || NONE}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
