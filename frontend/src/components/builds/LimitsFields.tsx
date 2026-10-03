/**
 * The limits a run stops at (time, commits, an optional budget) and the *done when* lines
 * the agent checks itself against. Shared by the new-build form and Continue.
 */
import type { BuildDraft, DraftErrors } from '../../lib/builds/form';
import { LIMITS, parseOptionalNumber } from '../../lib/builds/form';
import { removeAt, replaceAt } from '../../lib/builds/plan';
import { Field } from './Field';
import styles from './Fields.module.css';

export type Limits = Pick<BuildDraft, 'maxMinutes' | 'maxCommits' | 'maxBudget'>;

const shown = (n: number | null) => (n === null || !Number.isFinite(n) ? '' : String(n));
const whole = (raw: string) => (raw.trim() === '' ? NaN : Number(raw));

export function LimitsFields({ value, errors, onChange }: { value: Limits; errors: DraftErrors; onChange: (next: Limits) => void }) {
  return (
    <div className={styles.row}>
      <Field label="Minutes" hint={`${LIMITS.minutes.min} to ${LIMITS.minutes.max}`} error={errors.maxMinutes}>
        <input
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={LIMITS.minutes.min}
          max={LIMITS.minutes.max}
          value={shown(value.maxMinutes)}
          onChange={(e) => onChange({ ...value, maxMinutes: whole(e.target.value) })}
        />
      </Field>
      <Field label="Commits" hint={`${LIMITS.commits.min} to ${LIMITS.commits.max}`} error={errors.maxCommits}>
        <input
          className={styles.input}
          type="number"
          inputMode="numeric"
          min={LIMITS.commits.min}
          max={LIMITS.commits.max}
          value={shown(value.maxCommits)}
          onChange={(e) => onChange({ ...value, maxCommits: whole(e.target.value) })}
        />
      </Field>
      <Field label="Budget (USD)" hint="Empty: no cap" error={errors.maxBudget}>
        <input
          className={styles.input}
          type="number"
          inputMode="decimal"
          step="0.5"
          min={LIMITS.budget.min}
          max={LIMITS.budget.max}
          value={shown(value.maxBudget)}
          onChange={(e) => onChange({ ...value, maxBudget: parseOptionalNumber(e.target.value) })}
        />
      </Field>
    </div>
  );
}

/** "Done when": a short list of lines, each a criterion; add and remove freely. */
export function DoneWhenEditor({ lines, error, onChange }: { lines: string[]; error?: string | undefined; onChange: (next: string[]) => void }) {
  const full = lines.length >= LIMITS.doneWhen.count;
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Done when</legend>
      <p className={styles.hint}>What finished looks like. The agent stops by itself once every line holds.</p>
      {lines.length > 0 ? (
        <ol className={styles.lines}>
          {lines.map((line, i) => (
            <li key={i} className={styles.line}>
              <input
                className={styles.input}
                aria-label={`Done when, line ${i + 1}`}
                maxLength={LIMITS.doneWhen.length}
                value={line}
                onChange={(e) => onChange(replaceAt(lines, i, e.target.value))}
              />
              <button type="button" className={`btn btn-quiet ${styles.iconBtn}`} aria-label={`Remove line ${i + 1}`} onClick={() => onChange(removeAt(lines, i))}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <button type="button" className="btn btn-quiet" disabled={full} onClick={() => onChange([...lines, ''])}>
          + Add a line
        </button>
      </div>
    </fieldset>
  );
}
