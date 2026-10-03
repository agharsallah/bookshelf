/** Small form controls shared by the settings sections. */
import type { ReactNode } from 'react';
import styles from './Settings.module.css';

/** A card for one topic: an eyebrow, a title, a line saying what it is for, then its rows. */
export function Section({ id, eyebrow, title, hint, children }: { id: string; eyebrow: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <header className={styles.head}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h2 id={id} className={styles.title}>{title}</h2>
        {hint ? <p className={styles.hint}>{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

/** One of a few options, as a pressed-button group; an option can be held disabled (say why nearby). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export const titled = <T extends string>(values: readonly T[]) => values.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));
