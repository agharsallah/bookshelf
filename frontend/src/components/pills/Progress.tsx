/**
 * Story-style progress: one segment per pill of the session, filled up to the one on
 * screen. An endless session says how many it has shown instead.
 */
import styles from './Feed.module.css';

export function Progress({ current, total }: { current: number; total: number | null }) {
  if (total === null) {
    return (
      <p className={styles.count} aria-live="off">
        {current + 1} seen
      </p>
    );
  }
  const at = Math.min(current, total - 1);
  return (
    <div className={styles.progress} role="progressbar" aria-label="Session progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={at + 1} aria-valuetext={`Pill ${at + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} data-state={i < at ? 'done' : i === at ? 'current' : undefined} />
      ))}
    </div>
  );
}
