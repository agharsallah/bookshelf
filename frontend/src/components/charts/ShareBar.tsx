/** Part to whole in one bar: each part's width is its share; the legend carries the values. */
import type { Series } from './chart';
import { Legend } from './Legend';
import styles from './Charts.module.css';

export interface ShareBarProps {
  parts: readonly (Series & { value: number })[];
  format: (value: number, share: number) => string;
  label: string;
}

export function ShareBar({ parts, format, label }: ShareBarProps) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((sum, p) => sum + p.value, 0);
  if (total === 0) return <p className={styles.empty}>Nothing yet.</p>;
  return (
    <figure className={styles.frame} aria-label={label}>
      <div className={styles.share} role="img" aria-label={shown.map((p) => `${p.label} ${format(p.value, p.value / total)}`).join(', ')}>
        {shown.map((p) => (
          <span key={p.key} style={{ background: p.color, flexGrow: p.value, flexBasis: 0 }} title={`${p.label}: ${format(p.value, p.value / total)}`} />
        ))}
      </div>
      <Legend series={shown} values={Object.fromEntries(shown.map((p) => [p.key, format(p.value, p.value / total)]))} />
      {shown.length === 1 ? <p className={styles.legend}>{`${shown[0]?.label}: ${format(total, 1)}`}</p> : null}
    </figure>
  );
}
