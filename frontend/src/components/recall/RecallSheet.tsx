/**
 * The closed-book sheet: it covers the chapter while you write what you remember, waits
 * for the grade, then shows it. Ctrl/⌘+Enter submits; Escape closes (a grade still on
 * its way shows up at the end of the chapter).
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { RecallGrade } from '../../lib/api/types/recalls';
import { Kbd } from '../study/ReaderCites';
import { RecallResult } from './RecallResult';
import styles from './Recall.module.css';

export type SheetState =
  | { step: 'write'; saving: boolean }
  | { step: 'grading'; waitingForWorker: boolean }
  | { step: 'graded'; grade: RecallGrade }
  | { step: 'failed'; message: string };

export interface RecallSheetProps {
  chapter: string;
  state: SheetState;
  draft: string;
  onDraft: (text: string) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onShowGaps: () => void;
  onClose: () => void;
}

export function RecallSheet({ chapter, state, draft, onDraft, onSubmit, onRetry, onShowGaps, onClose }: RecallSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>('textarea, [data-autofocus]')?.focus();
  }, [state.step]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && state.step === 'write' && draft.trim()) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div ref={sheet} className={styles.sheet} role="dialog" aria-modal="true" aria-label={`Recall: ${chapter}`} onKeyDown={onKey}>
      <div className={styles.inner}>
        <p className={styles.eyebrow}>Closed-book recall</p>
        <h2 className={styles.title}>{chapter}</h2>
        {state.step === 'write' ? (
          <>
            <p className={styles.lede}>
              The chapter is out of sight. Write down its main claims, the evidence for them and the examples you remember, in your own words.
              Fragments are fine; it is graded on ideas, not wording.
            </p>
            <label className={styles.field}>
              What you remember
              <textarea value={draft} onChange={(event) => onDraft(event.target.value)} maxLength={20000} />
            </label>
            <div className={styles.actions}>
              <button type="button" className="btn btn-primary" disabled={!draft.trim() || state.saving} onClick={onSubmit}>
                {state.saving ? 'Saving…' : 'Grade my recall'} <Kbd>⌘↵</Kbd>
              </button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Back to the text
              </button>
              <span className={styles.spacer} />
              <span className={styles.hint}>Saved as written, never edited.</span>
            </div>
          </>
        ) : null}
        {state.step === 'grading' ? (
          <>
            <p className={styles.status} role="status">
              {state.waitingForWorker
                ? 'Saved. No worker is running, so it will be graded when one starts.'
                : 'Grading your recall against the chapter’s key ideas…'}
            </p>
            <div className={styles.actions}>
              <button type="button" className="btn btn-quiet" data-autofocus onClick={onClose}>
                Keep reading; show me at the end
              </button>
            </div>
          </>
        ) : null}
        {state.step === 'failed' ? (
          <>
            <p className={styles.problem} role="alert">
              It could not be graded: {state.message}
            </p>
            <div className={styles.actions}>
              <button type="button" className="btn btn-primary" data-autofocus onClick={onRetry}>
                Try again
              </button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : null}
        {state.step === 'graded' ? (
          <>
            <RecallResult grade={state.grade} />
            <div className={styles.actions}>
              {state.grade.ideas.some((i) => i.status !== 'recalled') ? (
                <button type="button" className="btn btn-primary" data-autofocus onClick={onShowGaps}>
                  Reopen the chapter, gaps marked
                </button>
              ) : null}
              <button type="button" className="btn btn-quiet" data-autofocus onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
