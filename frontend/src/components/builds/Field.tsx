/** Small building blocks shared by the build islands: a labelled field and the state badge. */
import { cloneElement, useId, type ReactElement } from 'react';
import type { BuildState } from '../../lib/api/types/builds';
import { STATE_LABELS, STATE_TONES } from '../../lib/builds/state';
import styles from './Fields.module.css';

interface ControlProps {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** A label, its control, a hint and an error, wired together for assistive tech. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | undefined; children: ReactElement<ControlProps> }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function StateBadge({ state }: { state: BuildState }) {
  return (
    <span className={styles.badge} data-tone={STATE_TONES[state]}>
      {STATE_LABELS[state]}
    </span>
  );
}
