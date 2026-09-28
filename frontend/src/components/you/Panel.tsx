/** One titled panel of the stats grid: a heading, an optional lede, then its figures. */
import type { ReactNode } from 'react';
import styles from './You.module.css';

export function Panel({ title, lede, wide = false, children }: { title: string; lede?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`${styles.panel} ${wide ? styles.wide : ''}`}>
      <h3 className={styles.panelTitle}>{title}</h3>
      {lede ? <p className={styles.panelLede}>{lede}</p> : null}
      {children}
    </section>
  );
}

/** A few labeled numbers in a row: the figures a panel's chart is about. */
export function Figures({ items }: { items: readonly { label: string; value: string }[] }) {
  return (
    <dl className={styles.figures}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
