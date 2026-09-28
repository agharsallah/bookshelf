/**
 * One tooltip per chart: the hovered or focused mark's values, value first, series second.
 * Content is React nodes, so labels from the data are text, never markup.
 */
import { useCallback, useState, type ReactNode } from 'react';
import styles from './Charts.module.css';

export interface TipRow {
  label: string;
  value: string;
  /** The series color, shown as a short line key. */
  color?: string;
}

export interface Tip {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

/** `show` at a point inside the chart's frame (its `position: relative` wrapper). */
export function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback((next: Tip) => setTip(next), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const flip = tip.x > width * 0.6;
  return (
    <div className={styles.tooltip} role="status" style={{ left: tip.x, top: tip.y, transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}>
      <p className={styles.tipTitle}>{tip.title}</p>
      {tip.rows.map((row) => (
        <p key={row.label} className={styles.tipRow}>
          {row.color ? <span className={styles.lineKey} style={{ background: row.color }} aria-hidden="true" /> : null}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </p>
      ))}
    </div>
  );
}

/** A chart's frame: the tooltip positions against it. */
export function Frame({ children, label, frameRef }: { children: ReactNode; label: string; frameRef?: React.Ref<HTMLDivElement> }) {
  return (
    <figure className={styles.frame} ref={frameRef} aria-label={label}>
      {children}
    </figure>
  );
}
