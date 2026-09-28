/**
 * The end of a pass, at the foot of the unit that closes it (passes.closingUnit).
 * Pass 1 asks three questions (what kind of paper, what it contributes, whether it earns a
 * second pass) and saves them as a prediction before marking the pass done; passes 2 and
 * 3 are one button, pass 3 after the reviewer's questions to answer for yourself.
 */
import type { PassNumber } from '../../../lib/api/types/papers';
import type { Spans as SpanList } from '../../../lib/contract';
import { CiteProvider } from '../../blocks/CiteContext';
import { Spans } from '../../blocks';
import { PASS_LABELS } from '../../papers/labels';
import { CATEGORIES, canSubmit, WORTH_LABELS, WORTH_OPTIONS, type FlowEvent, type FlowState, type SkimAnswers } from './flow';
import styles from './Paper.module.css';

export interface PassEndCardProps {
  pass: PassNumber;
  state: FlowState;
  dispatch: (event: FlowEvent) => void;
  questions: readonly SpanList[];
  onCite: (anchor: string) => void;
  citeHref: (anchor: string) => string;
  /** Start the next pass (absent after pass 3). */
  onNext: (() => void) | null;
}

const ENDINGS: Record<PassNumber, string> = {
  1: 'You have the shape of the paper. Before going on, say what you make of it.',
  2: 'You have read the argument and its evidence.',
  3: 'You have gone through all of it, appendix included.',
};

function SkimQuestions({ answers, dispatch, saving, failed }: { answers: SkimAnswers; dispatch: PassEndCardProps['dispatch']; saving: boolean; failed: boolean }) {
  const set = (change: Partial<SkimAnswers>) => dispatch({ type: 'answer', answers: change });
  return (
    <form
      className={styles.skimForm}
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ type: failed ? 'retry' : 'submit' });
      }}
    >
      <label className={styles.field}>
        What kind of paper is it?
        <input list="paper-categories" value={answers.category} maxLength={200} onChange={(e) => set({ category: e.target.value })} />
        <datalist id="paper-categories">
          {CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className={styles.field}>
        Its main contribution, in a sentence or two
        <textarea value={answers.contribution} maxLength={4000} rows={3} onChange={(e) => set({ contribution: e.target.value })} />
      </label>
      <fieldset className={styles.worth}>
        <legend>Is it worth a second pass?</legend>
        {WORTH_OPTIONS.map((w) => (
          <label key={w} data-checked={answers.worth === w ? '' : undefined}>
            <input type="radio" name="worth" value={w} checked={answers.worth === w} onChange={() => set({ worth: w })} />
            {WORTH_LABELS[w]}
          </label>
        ))}
      </fieldset>
      <div className={styles.cardActions}>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit(answers) || saving}>
          {saving ? 'Saving…' : 'Save and finish pass 1'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => dispatch({ type: 'cancel' })}>
          Not yet
        </button>
      </div>
    </form>
  );
}

export function PassEndCard({ pass, state, dispatch, questions, onCite, citeHref, onNext }: PassEndCardProps) {
  const { name } = PASS_LABELS[pass];
  const saving = state.step === 'saving';
  // Pass 1's answers, while they are being written, saved or retried.
  const answers = state.step === 'asking' || state.step === 'saving' || state.step === 'failed' ? (state.answers ?? null) : null;
  return (
    <section id="pass-end" className={styles.endCard} data-pass={pass} aria-labelledby="pass-end-title">
      <p className={styles.endStep} aria-hidden="true">
        {pass}
      </p>
      <h2 id="pass-end-title" className={styles.endTitle}>
        End of pass {pass}: {name.toLowerCase()}
      </h2>
      <p className={styles.endLede}>{ENDINGS[pass]}</p>

      {pass === 3 && questions.length ? (
        <div className={styles.prompts}>
          <h3>A reviewer would ask</h3>
          <CiteProvider value={{ onCite, citeHref }}>
            <ol>
              {questions.map((q, i) => (
                <li key={i}>
                  <Spans spans={q} />
                </li>
              ))}
            </ol>
          </CiteProvider>
        </div>
      ) : null}

      {state.step === 'done' ? (
        <div className={styles.cardActions} role="status">
          <span className={styles.doneStamp}>Pass {pass} done</span>
          {onNext ? (
            <button type="button" className="btn btn-primary" onClick={onNext}>
              Start pass {pass + 1}
            </button>
          ) : null}
        </div>
      ) : answers ? (
        <SkimQuestions answers={answers} dispatch={dispatch} saving={saving} failed={state.step === 'failed'} />
      ) : (
        <div className={styles.cardActions}>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => dispatch({ type: state.step === 'failed' ? 'retry' : 'finish' })}>
            {saving ? 'Saving…' : pass === 1 ? 'Finish pass 1' : `Mark pass ${pass} done`}
          </button>
        </div>
      )}
      {state.step === 'failed' ? (
        <p className={styles.error} role="alert">
          Not saved: {state.message}{' '}
          <button type="button" className={styles.linkButton} onClick={() => dispatch({ type: 'retry' })}>
            Try again
          </button>
        </p>
      ) : null}
    </section>
  );
}
