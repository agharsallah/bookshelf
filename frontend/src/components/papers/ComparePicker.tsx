/**
 * "Compare with…": pick other papers on the shelf that have a results table, then open
 * the results matrix of all of them (`/papers/compare?ids=this,picked…`).
 */
import { useState } from 'react';
import { compareHref } from './results';
import styles from './PaperControls.module.css';

export interface CompareOption {
  slug: string;
  title: string;
  year: number | null;
}

export interface ComparePickerProps {
  slug: string;
  others: CompareOption[];
}

export function ComparePicker({ slug, others }: ComparePickerProps) {
  const [picked, setPicked] = useState<string[]>([]);
  if (others.length === 0) {
    return <p className={styles.compareNone}>No other paper on your shelf has a results table to compare with yet.</p>;
  }
  const toggle = (s: string) => setPicked((now) => (now.includes(s) ? now.filter((p) => p !== s) : [...now, s]));
  return (
    <fieldset className={styles.compare}>
      <legend className={styles.controlTitle}>Compare with…</legend>
      <ul>
        {others.map((o) => (
          <li key={o.slug}>
            <label>
              <input type="checkbox" checked={picked.includes(o.slug)} onChange={() => toggle(o.slug)} />
              <span>
                {o.title}
                {o.year ? <span className={styles.compareYear}> {o.year}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {picked.length > 0 ? (
        <a className="btn btn-primary" href={compareHref([slug, ...picked])}>
          Compare {picked.length + 1} papers
        </a>
      ) : (
        <span className={styles.compareHint}>Pick at least one paper.</span>
      )}
    </fieldset>
  );
}

export default ComparePicker;
