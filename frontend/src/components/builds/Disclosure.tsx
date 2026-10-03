/**
 * Building blocks of the form's optional depth: a disclosure whose summary line keeps
 * telling its state while closed (native `<details>`, so keyboard and `aria-expanded`
 * come for free), a labelled switch, a chips input and a character counter.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import fields from './Fields.module.css';
import styles from './Disclosure.module.css';

export interface DisclosureProps {
  title: string;
  /** The state while closed: `Paper brief · 1 840 words…`; announced as it changes. */
  meta: string;
  /** A pill at the end of the summary (`3 changed`). */
  badge?: string | null;
  /** Opens it (for example when a field inside has an error); never closes it. */
  forceOpen?: boolean;
  children: ReactNode;
}

export function Disclosure({ title, meta, badge, forceOpen = false, children }: DisclosureProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (forceOpen && ref.current) ref.current.open = true;
  }, [forceOpen]);
  return (
    <details ref={ref} className={styles.disclosure}>
      <summary className={styles.summary}>
        <span className={styles.chevron} aria-hidden="true" />
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          <span className={styles.meta} aria-live="polite">
            {meta}
          </span>
        </span>
        <span aria-live="polite">{badge ? <span className={styles.badge}>{badge}</span> : null}</span>
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}

/** A checkbox drawn as a switch, with its label. */
export function Switch({ label, checked, onChange, hidden = false }: { label: string; checked: boolean; onChange: (on: boolean) => void; hidden?: boolean }) {
  return (
    <label className={styles.switchLabel}>
      <input type="checkbox" role="switch" className={styles.switch} checked={checked} aria-label={hidden ? label : undefined} onChange={(e) => onChange(e.target.checked)} />
      {hidden ? null : <span>{label}</span>}
    </label>
  );
}

/** `120 / 8000`, red past the limit. */
export function Counter({ length, max, id }: { length: number; max: number; id?: string }) {
  return (
    <span id={id} className={styles.counter} data-over={length > max || undefined}>
      {length} / {max}
    </span>
  );
}

/** Enter in a nested mini-form does its own thing, never submits the build form around it. */
export const onEnter = (action: () => void) => (event: KeyboardEvent) => {
  const target = event.target;
  if (event.key !== 'Enter' || !(target instanceof HTMLInputElement) || target.type === 'checkbox') return;
  event.preventDefault();
  action();
};

export interface ChipsInputProps {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
  /** Why a value cannot go in, or null. */
  validate: (value: string) => string | null;
  max: number;
  placeholder?: string;
  /** A problem with the list as a whole (from the form's validation). */
  error?: string | undefined;
}

/** A short list of tokens: type one, Enter or Add; each shows as a chip you can remove. */
export function ChipsInput({ label, hint, values, onChange, validate, max, placeholder, error }: ChipsInputProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const full = values.length >= max;
  const shown = problem ?? error;

  const add = () => {
    const value = text.trim();
    if (!value) return;
    const why = values.includes(value) ? 'Already in the list.' : full ? `At most ${max}.` : validate(value);
    setProblem(why);
    if (why) return;
    onChange([...values, value]);
    setText('');
  };

  return (
    <div className={fields.field}>
      <label className={fields.label} htmlFor={id}>
        {label}
      </label>
      {values.length > 0 ? (
        <ul className={styles.tags} aria-label={label}>
          {values.map((v) => (
            <li key={v} className={styles.tag}>
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.inputRow}>
        <input
          id={id}
          className={`${fields.input} ${fields.mono}`}
          value={text}
          placeholder={full ? `${max} of ${max}` : placeholder}
          disabled={full}
          aria-invalid={shown ? true : undefined}
          aria-describedby={`${id}-hint${shown ? ` ${id}-error` : ''}`}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          onKeyDown={onEnter(add)}
        />
        <button type="button" className="btn" disabled={full || !text.trim()} onClick={add}>
          Add
        </button>
      </div>
      <p id={`${id}-hint`} className={fields.hint}>
        {hint}
      </p>
      {shown ? (
        <p id={`${id}-error`} className={fields.error}>
          {shown}
        </p>
      ) : null}
    </div>
  );
}
