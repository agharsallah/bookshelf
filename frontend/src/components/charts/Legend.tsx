/** The legend: always present for two or more series; a swatch beside text in ink. */
import type { Series } from './chart';
import styles from './Charts.module.css';

export function Legend({ series, values }: { series: readonly Series[]; values?: Record<string, string> }) {
  if (series.length < 2) return null;
  return (
    <ul className={styles.legend}>
      {series.map((s) => (
        <li key={s.key}>
          <span className={styles.swatch} style={{ background: s.color }} aria-hidden="true" />
          {s.label}
          {values?.[s.key] ? <span className={styles.legendValue}>{values[s.key]}</span> : null}
        </li>
      ))}
    </ul>
  );
}
