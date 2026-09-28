/**
 * The toolbar's three-pass control (papers only). Off, one button with a three-tick meter
 * of the passes done. On, the three passes as joined steps (the one being read pressed, a
 * tick on each done), the notation panel toggle from pass 2, and a way out.
 */
import type { PassNumber } from '../../../lib/api/types/papers';
import { PASSES } from '../../../lib/api/types/papers';
import { PASS_LABELS } from '../../papers/labels';
import styles from './Paper.module.css';

export interface PassControlProps {
  pass: PassNumber | null;
  done: ReadonlySet<number>;
  /** Turn the mode on (at the next pass not done) or off. */
  onToggle: () => void;
  onPass: (pass: PassNumber) => void;
  notation: { open: boolean; onToggle: () => void } | null;
}

function Ticks({ done }: { done: ReadonlySet<number> }) {
  return (
    <span className={styles.ticks} aria-hidden="true">
      {PASSES.map((p) => (
        <span key={p} data-done={done.has(p) ? '' : undefined} />
      ))}
    </span>
  );
}

export function PassControl({ pass, done, onToggle, onPass, notation }: PassControlProps) {
  if (pass === null) {
    const count = PASSES.filter((p) => done.has(p)).length;
    return (
      <button
        type="button"
        className={styles.passOff}
        aria-pressed="false"
        title="Read in three passes: skim, read, re-create (p)"
        onClick={onToggle}
      >
        Passes
        <Ticks done={done} />
        <span className="visually-hidden">, {count} of 3 done</span>
      </button>
    );
  }
  return (
    <span className={styles.passControl}>
      <span className={styles.passSteps} role="group" aria-label="Three-pass reading">
        {PASSES.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={p === pass}
            data-done={done.has(p) ? '' : undefined}
            aria-label={`Pass ${p}: ${PASS_LABELS[p].name}${done.has(p) ? ', done' : ''}`}
            title={PASS_LABELS[p].hint}
            onClick={() => onPass(p)}
          >
            {p}
            {p === pass ? <span className={styles.passName}>{PASS_LABELS[p].name}</span> : null}
          </button>
        ))}
      </span>
      {notation ? (
        <button type="button" aria-pressed={notation.open} title="Symbols and what they mean" onClick={notation.onToggle}>
          Notation
        </button>
      ) : null}
      <button type="button" className={styles.passLeave} aria-label="Leave three-pass mode" title="Show the whole paper (p)" onClick={onToggle}>
        ×
      </button>
    </span>
  );
}
