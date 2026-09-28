/** What the statistics say about you, what needs you first. Tone is an icon and a word, not only a color. */
import type { ReaderInsight } from '../../lib/api/types/readerStats';
import { TONES } from './model';
import styles from './You.module.css';

export function Insights({ insights }: { insights: readonly ReaderInsight[] }) {
  if (insights.length === 0) return <p className={styles.panelLede}>Nothing stands out yet: read a little more and come back.</p>;
  return (
    <ul className={styles.insights}>
      {insights.map((insight, i) => (
        <li key={`${insight.metric}:${i}`} className={styles.insight} data-tone={insight.tone}>
          <p className={styles.insightMeta}>
            <span className={styles.toneIcon} aria-hidden="true">
              {TONES[insight.tone].icon}
            </span>
            <span>{TONES[insight.tone].label}</span>
            <span>· {insight.topic}</span>
          </p>
          <p className={styles.insightTitle}>{insight.href ? <a href={insight.href}>{insight.title}</a> : insight.title}</p>
          <p className={styles.insightDetail}>{insight.detail}</p>
        </li>
      ))}
    </ul>
  );
}
