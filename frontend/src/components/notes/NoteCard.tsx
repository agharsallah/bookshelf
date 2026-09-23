/**
 * One note: the passage it marks, your words verbatim, and — when the
 * structure-note skill has run — its structured version beside them, which you can
 * accept or dismiss. Raw text is never editable (D11); colour is, and the note can
 * be deleted after a confirmation.
 */
import { useState } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { NoteDetail } from '../../lib/api/types/notes';
import { HIGHLIGHT_COLORS, type HighlightColor, type RenderBlock } from '../../lib/contract';
import { Blocks } from '../blocks/Blocks';
import styles from './NotesPanel.module.css';

export interface NoteCardProps {
  note: NoteDetail;
  passage: string | null;
  focused: boolean;
  onReveal: (anchor: string) => void;
  onCite: (anchor: string) => void;
  onColor: (note: NoteDetail, color: HighlightColor) => void;
  onDelete: (note: NoteDetail) => void;
  onReview: (note: NoteDetail, action: 'approve' | 'reject') => void;
}

const REVIEW_WORDS = { draft: 'Suggested', needs_review: 'Suggested, flagged', approved: 'Accepted', rejected: 'Dismissed' } as const;

export function NoteCard({ note, passage, focused, onReveal, onCite, onColor, onDelete, onReview }: NoteCardProps) {
  const [confirming, setConfirming] = useState(false);
  const structured = note.structured;
  const showStructured = structured !== null && structured.review !== 'rejected';
  const isHighlightOnly = passage !== null && note.raw.trim() === passage.trim();

  return (
    <article
      className={styles.card}
      data-note-id={note.id}
      data-color={note.color ?? 'amber'}
      data-focused={focused ? '' : undefined}
      tabIndex={-1}
      aria-label={`Note on ${note.anchor}`}
    >
      <header className={styles.cardHead}>
        <button type="button" className={styles.where} onClick={() => onReveal(note.anchor)} disabled={note.detached}>
          {anchorLabel(note.anchor)}
        </button>
        <time className={styles.when} dateTime={note.created_at}>
          {new Date(note.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </time>
      </header>

      {passage && !isHighlightOnly ? <blockquote className={styles.passage}>{passage}</blockquote> : null}

      <div className={showStructured ? styles.sideBySide : undefined}>
        <div className={styles.raw}>
          <p className={styles.caption}>{isHighlightOnly ? 'Highlight' : 'Your words'}</p>
          <p className={styles.rawText}>{note.raw}</p>
        </div>
        {showStructured ? (
          <div className={styles.structured} data-review={structured.review}>
            <p className={styles.caption}>{REVIEW_WORDS[structured.review]} structured version</p>
            <Blocks blocks={(structured.body.blocks ?? []) as RenderBlock[]} onCite={onCite} />
            {structured.body.tags && structured.body.tags.length > 0 ? (
              <p className={styles.tags}>
                {structured.body.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </p>
            ) : null}
            {structured.review !== 'approved' ? (
              <div className={styles.reviewRow}>
                <button type="button" onClick={() => onReview(note, 'approve')}>
                  Accept
                </button>
                <button type="button" onClick={() => onReview(note, 'reject')}>
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className={styles.cardFoot}>
        <div className={styles.colors} role="radiogroup" aria-label="Note colour">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={(note.color ?? 'amber') === c}
              aria-label={c}
              className={styles.swatch}
              data-color={c}
              onClick={() => onColor(note, c)}
            />
          ))}
        </div>
        {confirming ? (
          <span className={styles.confirm} role="group" aria-label="Confirm deletion">
            Delete this note?
            <button type="button" className={styles.danger} onClick={() => onDelete(note)}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className={styles.deleteButton} onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </footer>
    </article>
  );
}
