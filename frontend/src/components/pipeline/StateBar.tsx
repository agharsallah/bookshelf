/**
 * A count of jobs as one bar split by state, in the chart series: done, running, queued,
 * failed, skipped. Each part eases to its new length only when its count changes (a
 * width transition never runs on first paint), and not at all under reduced motion.
 * `Bumped` flashes a number with the highlighter when it changes, for the same reason.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { JobState } from '../../lib/api/types/jobs';
import { totalOf, type StateCounts } from './model';
import styles from './StateBar.module.css';

/** Drawing order: finished work first, then live work, then what went wrong. */
export const BAR_STATES: readonly JobState[] = ['done', 'running', 'queued', 'failed', 'skipped'];

export interface StateBarProps {
  counts: StateCounts;
  /** Longest bar's total, so bars side by side share a scale; defaults to this bar's own. */
  scale?: number;
  /** Paint the whole bar in one state when there are no jobs (a stage the status says is done). */
  fill?: JobState | null;
  /** No empty track behind the parts (bars on a shared scale). */
  bare?: boolean;
}

export function StateBar({ counts, scale, fill = null, bare = false }: StateBarProps) {
  const total = totalOf(counts);
  const of = Math.max(1, scale ?? total);
  return (
    <span className={styles.bar} data-bare={bare || undefined} aria-hidden="true">
      {total === 0 && fill ? <span className={styles.part} data-state={fill} style={{ inlineSize: '100%' }} /> : null}
      {BAR_STATES.map((state) =>
        counts[state] > 0 ? <span key={state} className={styles.part} data-state={state} style={{ inlineSize: `${(counts[state] / of) * 100}%` }} /> : null,
      )}
    </span>
  );
}

/** A counter that goes up each time `value` changes after the first render. */
export function useBump(value: unknown): number {
  const previous = useRef(value);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setBump((n) => n + 1);
  }, [value]);
  return bump;
}

/** A number that marks itself for a moment when it changes. */
export function Bumped({ value, className, children }: { value: number; className?: string; children?: ReactNode }) {
  const bump = useBump(value);
  const cls = [className, bump > 0 ? styles.bumped : ''].filter(Boolean).join(' ');
  return (
    <span key={bump} className={cls || undefined}>
      {children ?? value}
    </span>
  );
}

/** The state's swatch, for tallies and legends. */
export function Swatch({ state }: { state: JobState }) {
  return <span className={styles.swatch} data-state={state} aria-hidden="true" />;
}
