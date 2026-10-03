/**
 * One job kind and how the queue runs it: as usual, first, on hold, or (only where its
 * stage moves on without it) skipped. Shared by the Pipeline's Priorities panel and
 * Settings → Job kinds. With `most`, a bar scales its queued count against the busiest kind.
 */
import type { ReactNode } from 'react';
import type { KindMode } from '../../lib/api/types/jobs';
import type { SteeringRow } from './steering';
import styles from './KindModeTile.module.css';

const CHOICES: { mode: KindMode | null; label: string; hint: string }[] = [
  { mode: null, label: 'As usual', hint: 'In the pipeline’s own order' },
  { mode: 'first', label: 'First', hint: 'Before other queued work' },
  { mode: 'hold', label: 'Hold', hint: 'Waits in the queue; its books’ later stages wait too' },
  { mode: 'skip', label: 'Skip', hint: 'Dropped as it comes up, like Cancel; its stage moves on without it' },
];

/** The grid the tiles sit in, labelled by what they are. */
export function KindModeTiles({ children }: { children: ReactNode }) {
  return <ul className={styles.tiles}>{children}</ul>;
}

export interface KindModeTileProps {
  row: SteeringRow;
  disabled: boolean;
  onMode: (mode: KindMode | null) => void;
  /** The busiest kind's queued count: draws the bar. Leave out for no bar. */
  most?: number;
  /** An anchor to link to this kind (Settings). */
  id?: string;
}

export function KindModeTile({ row, disabled, onMode, most, id }: KindModeTileProps) {
  const choices = CHOICES.filter(({ mode }) => mode !== 'skip' || row.skippable);
  return (
    <li className={styles.tile} data-mode={row.mode ?? 'usual'} id={id}>
      <span className={styles.head}>
        <span className={styles.label}>{row.label}</span>
        <span className={styles.queued}>{row.queued ? `${row.queued} queued` : most === undefined ? '' : '0'}</span>
      </span>
      {most !== undefined ? (
        <span className={styles.bar} aria-hidden="true">
          <span style={{ inlineSize: `${(row.queued / Math.max(most, 1)) * 100}%` }} />
        </span>
      ) : null}
      <span className={styles.segmented} role="group" aria-label={`${row.label}: how it runs`}>
        {choices.map(({ mode, label, hint }) => (
          <button key={label} type="button" aria-pressed={row.mode === mode} disabled={disabled} title={hint} onClick={() => row.mode !== mode && onMode(mode)}>
            {label}
          </button>
        ))}
      </span>
    </li>
  );
}
