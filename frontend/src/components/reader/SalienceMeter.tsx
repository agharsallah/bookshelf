/**
 * The key-ideas meter at the foot of the text: a ring that fills as each core idea
 * and key point scrolls past, and a short burst of sparks when the last one does.
 * Clicking it jumps to the next idea you have not reached yet.
 */
import type { CSSProperties } from 'react';
import styles from './Salience.module.css';

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SPARKS = 8;

export interface SalienceMeterProps {
  seen: number;
  total: number;
  onNext: () => void;
}

export function SalienceMeter({ seen, total, onNext }: SalienceMeterProps) {
  if (total === 0) return null;
  const done = seen >= total;
  const share = Math.min(1, seen / total);
  return (
    <div className={styles.meterDock}>
      <button type="button" className={styles.meter} data-done={done ? '' : undefined} onClick={onNext} title="Next key idea (.)">
        <svg className={styles.ring} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r={RADIUS} className={styles.ringTrack} />
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            className={styles.ringFill}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - share)}
          />
        </svg>
        <span aria-live="polite">
          {done ? 'All key ideas found' : `${seen} of ${total} key ideas`}
        </span>
        {done ? (
          <span className={styles.sparks} aria-hidden="true">
            {Array.from({ length: SPARKS }, (_, i) => (
              <i key={i} style={{ '--i': i } as CSSProperties} />
            ))}
          </span>
        ) : null}
      </button>
    </div>
  );
}
