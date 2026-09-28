/**
 * Before an unread chapter: only its title and section headings, and what you think it
 * will argue. Guessing first makes what you then read stick (pretesting); your guess is
 * kept, and the grade of your recall at the end sets it against what the chapter argues.
 * Skipping is one key (Escape).
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import styles from './Recall.module.css';

export interface PredictCardProps {
  chapter: string;
  sections: readonly string[];
  draft: string;
  saving: boolean;
  onDraft: (text: string) => void;
  onSave: () => void;
  onSkip: () => void;
}

export function PredictCard({ chapter, sections, draft, saving, onDraft, onSave, onSkip }: PredictCardProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onSkip();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && draft.trim()) {
      event.preventDefault();
      onSave();
    }
  };

  return (
    <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={`Before you read: ${chapter}`} onKeyDown={onKey}>
      <div className={styles.inner}>
        <p className={styles.eyebrow}>Before you read</p>
        <h2 className={styles.title}>{chapter}</h2>
        {sections.length ? (
          <ol className={styles.sections} aria-label="Sections">
            {sections.map((heading, i) => (
              <li key={i}>{heading}</li>
            ))}
          </ol>
        ) : null}
        <label className={`${styles.field} ${styles.compact}`}>
          From the title and headings alone, what do you think this chapter will argue?
          <textarea ref={field} value={draft} onChange={(event) => onDraft(event.target.value)} maxLength={20000} />
        </label>
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary" disabled={!draft.trim() || saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save and read'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onSkip}>
            Skip
          </button>
          <span className={styles.spacer} />
          <span className={styles.hint}>Compared with the chapter when you recall it.</span>
        </div>
      </div>
    </div>
  );
}
