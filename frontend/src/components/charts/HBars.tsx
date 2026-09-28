/**
 * Ranked horizontal bars in HTML, so long labels (book and chapter titles) wrap or ellipsize
 * instead of colliding. Bars share one scale; with several series each bar is stacked with
 * a 2px gap and the value sits at its tip. A row may link somewhere.
 */
import type { Series } from './chart';
import { Legend } from './Legend';
import styles from './Charts.module.css';

export interface BarRow {
  key: string;
  label: string;
  sub?: string;
  href?: string;
  values: Record<string, number>;
  /** What the tip says; the formatted total by default. */
  valueLabel?: string;
}

export interface HBarsProps {
  rows: readonly BarRow[];
  series: readonly Series[];
  format: (value: number) => string;
  label: string;
  /** The value the full width stands for; the largest row by default. */
  max?: number;
  empty?: string;
}

export function HBars({ rows, series, format, label, max, empty = 'Nothing here yet.' }: HBarsProps) {
  if (rows.length === 0) return <p className={styles.empty}>{empty}</p>;
  const total = (r: BarRow) => series.reduce((sum, s) => sum + (r.values[s.key] ?? 0), 0);
  const scale = max ?? Math.max(1, ...rows.map(total));
  return (
    <figure className={styles.frame} aria-label={label}>
      <Legend series={series} />
      <ol className={styles.bars}>
        {rows.map((row) => {
          const sum = total(row);
          const name = row.href ? <a href={row.href}>{row.label}</a> : row.label;
          return (
            <li key={row.key} className={styles.barRow}>
              <span className={styles.barLabel} title={row.label}>
                {name}
                {row.sub ? <span className={styles.barSub}>{row.sub}</span> : null}
              </span>
              <span className={styles.barTrack}>
                <span className={styles.barFill} style={{ inlineSize: `${(sum / scale) * 100}%` }}>
                  {series
                    .filter((s) => (row.values[s.key] ?? 0) > 0)
                    .map((s) => (
                      <span
                        key={s.key}
                        className={styles.barSegment}
                        style={{ background: s.color, flexGrow: row.values[s.key] ?? 0, flexBasis: 0 }}
                        title={`${s.label}: ${format(row.values[s.key] ?? 0)}`}
                      />
                    ))}
                </span>
                <span className={styles.barValue}>{row.valueLabel ?? format(sum)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
