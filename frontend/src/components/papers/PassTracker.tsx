/**
 * The three passes through a paper (skim, read, re-create; docs/PAPERS.md §6) as three
 * joined steps. Selecting a step marks it done (`PUT /papers/{ref}/passes/{n}`) or, when
 * it is done, undoes it (`DELETE`). The change shows at once and is rolled back if the
 * server refuses it.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { PaperPassPublic, PassNumber } from '../../lib/api/types/papers';
import { completePass, undoPass } from '../../lib/papers/api';
import { problemOf } from '../common/Problem';
import { passSteps, withPass } from './rating';
import styles from './PaperControls.module.css';

export interface PassTrackerProps {
  paperRef: string;
  documentId: string;
  passes: PaperPassPublic[];
  api?: Pick<ApiClient, 'post' | 'put' | 'patch' | 'delete'>;
}

const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function PassTracker({ paperRef, documentId, passes: initial, api = browserApi }: PassTrackerProps) {
  const [passes, setPasses] = useState(initial);
  const [busy, setBusy] = useState<PassNumber | null>(null);
  const [error, setError] = useState<string | null>(null);
  const steps = passSteps(passes);
  const next = steps.find((s) => !s.done) ?? null;

  const toggle = async (pass: PassNumber, done: boolean) => {
    const before = passes;
    const optimistic: PaperPassPublic | null = done ? null : { document_id: documentId, pass, completed_at: new Date().toISOString(), note: null };
    setPasses(withPass(passes, pass, optimistic));
    setBusy(pass);
    setError(null);
    try {
      if (done) {
        await undoPass(api, paperRef, pass);
      } else {
        // The optimistic row stands until the server's (with its real time) replaces it.
        const saved = await completePass(api, paperRef, pass);
        setPasses((current) => withPass(current, pass, saved));
      }
    } catch (problem) {
      setPasses(before);
      setError(problemOf(problem).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.passes} aria-labelledby="passes-title">
      <h2 id="passes-title" className={styles.controlTitle}>
        Reading passes
      </h2>
      <ol className={styles.steps}>
        {steps.map((step) => (
          <li key={step.pass}>
            <button
              type="button"
              className={styles.step}
              aria-pressed={step.done}
              disabled={busy !== null}
              title={step.hint}
              onClick={() => void toggle(step.pass, step.done)}
            >
              <span className={styles.stepNumber} aria-hidden="true">
                {step.done ? '✓' : step.pass}
              </span>
              <span className={styles.stepName}>
                <span className="visually-hidden">Pass {step.pass}: </span>
                {step.name}
              </span>
              <span className={styles.stepWhen}>{step.completedAt ? dateOf(step.completedAt) : 'Not yet'}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className={styles.stepHint} aria-live="polite">
        {error ? <span className={styles.error}>Not saved: {error}</span> : next ? `Next, pass ${next.pass}: ${next.hint}` : 'All three passes done.'}
      </p>
    </section>
  );
}

export default PassTracker;
