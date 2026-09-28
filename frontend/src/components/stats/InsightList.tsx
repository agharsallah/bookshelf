/**
 * What to improve, most severe first. Severity is a glyph and a word as well as a
 * colour; each insight names the metric and value that raised it, so the next run can
 * show whether a change to the skill moved it.
 */
import type { Insight } from '../../lib/api/types/stats';
import { formatNumber } from './format';
import { AREA_LABELS, SEVERITY_ICONS, SEVERITY_LABELS } from './model';
import styles from './InsightList.module.css';

function Item({ insight }: { insight: Insight }) {
  return (
    <li className={styles.item} data-severity={insight.severity}>
      <p className={styles.meta}>
        <span className={styles.severity}>
          <span aria-hidden="true">{SEVERITY_ICONS[insight.severity]}</span> {SEVERITY_LABELS[insight.severity]}
        </span>
        <span>{AREA_LABELS[insight.area]}</span>
        <code className={styles.subject}>{insight.subject}</code>
      </p>
      <p className={styles.title}>{insight.title}</p>
      <p className={styles.detail}>{insight.detail}</p>
      <p className={styles.metric}>
        {insight.metric} = {formatNumber(insight.value, 3)}
        {insight.threshold !== null ? ` (threshold ${formatNumber(insight.threshold, 3)})` : ''}
      </p>
    </li>
  );
}

function Items({ insights }: { insights: readonly Insight[] }) {
  return (
    <ol className={styles.list}>
      {insights.map((insight, i) => (
        <Item key={`${insight.metric}:${insight.subject}:${i}`} insight={insight} />
      ))}
    </ol>
  );
}

/** Problems in view; notes (severity `info`) fold under a disclosure once there are problems. */
export function InsightList({ insights }: { insights: readonly Insight[] }) {
  if (insights.length === 0) {
    return <p className={styles.none}>Nothing stands out: no skill or stage crosses a threshold.</p>;
  }
  const problems = insights.filter((i) => i.severity !== 'info');
  const notes = insights.filter((i) => i.severity === 'info');
  if (problems.length === 0 || notes.length === 0) return <Items insights={insights} />;
  return (
    <div className={styles.group}>
      <Items insights={problems} />
      <details className={styles.more}>
        <summary>
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}: cheaper tiers, cost drivers, outliers
        </summary>
        <Items insights={notes} />
      </details>
    </div>
  );
}
