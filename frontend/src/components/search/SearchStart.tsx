/**
 * Before the first query: somewhere to start. Your recent searches (kept per browser,
 * recent.ts), a few of the shelf's most connected concepts to search for, and the ways
 * a query can be phrased, so the modes never need explaining.
 */
import type { RecentEntry } from './recent';
import styles from './Search.module.css';

export interface Suggestion {
  label: string;
  href: string;
}

const WAYS: { example: string; does: string }[] = [
  { example: 'how do feedback loops fail?', does: 'An idea in your own words finds it by meaning.' },
  { example: '"stocks and flows"', does: 'A phrase in quotes finds those exact words.' },
  { example: 'chapter 3 of Thinking in Systems', does: 'A chapter you name opens that chapter.' },
  { example: 'compare habits vs systems', does: '"Compare" or "vs" looks across books.' },
];

export function SearchStart({ recent, suggestions }: { recent: readonly RecentEntry[]; suggestions: readonly Suggestion[] }) {
  return (
    <div className={styles.start}>
      {recent.length ? (
        <section className={styles.startBlock} aria-labelledby="recent-title">
          <h2 id="recent-title">Recent searches</h2>
          <ul className={styles.recent}>
            {recent.map((r) => (
              <li key={r.href}>
                <a href={r.href}>{r.label}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {suggestions.length ? (
        <section className={styles.startBlock} aria-labelledby="suggest-title">
          <h2 id="suggest-title">Concepts to look up</h2>
          <ul className={styles.suggestions}>
            {suggestions.map((s) => (
              <li key={s.href}>
                <a href={s.href}>{s.label}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className={styles.startBlock} aria-labelledby="ways-title">
        <h2 id="ways-title">Ways to ask</h2>
        <dl className={styles.ways}>
          {WAYS.map((w) => (
            <div key={w.example}>
              <dt>{w.example}</dt>
              <dd>{w.does}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
