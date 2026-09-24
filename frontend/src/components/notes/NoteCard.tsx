/**
 * One note: the passage it marks, your words verbatim, and — when the
 * structure-note skill has run — its structured version beside them, which you can
 * accept or dismiss. A plain highlight has no words yet and can be given them once;
 * after that they are never editable (D11). Colour is, and the note can be deleted
 * after a confirmation.
 */
import { useId, useState } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { NoteDetail } from '../../lib/api/types/notes';
import { HIGHLIGHT_COLORS, type HighlightColor, type RenderBlock } from '../../lib/contract';
import { Blocks } from '../blocks/Blocks';
import styles from './NotesPanel.module.css';

export interface NoteCardProps {
  note: NoteDetail;
  focused: boolean;
  /** A pane note on an earlier version of the distillation or summary than the one shown. */
  earlier?: boolean;
  onReveal: (note: NoteDetail) => void;
  onCite: (anchor: string) => void;
  onColor: (note: NoteDetail, color: HighlightColor) => void;
  /** Give a plain highlight its words; resolves true once they are stored. */
  onAddWords: (note: NoteDetail, raw: string) => Promise<boolean>;
  onDelete: (note: NoteDetail) => void;
  onReview: (note: NoteDetail, action: 'approve' | 'reject') => void;
}

const PANE_WORDS = { chapter_distillation: 'Distillation', chapter_summary: 'Summary' } as const;

const REVIEW_WORDS = { draft: 'Suggested', needs_review: 'Suggested, flagged', approved: 'Accepted', rejected: 'Dismissed' } as const;

function AddWords({ note, onAddWords }: Pick<NoteCardProps, 'note' | 'onAddWords'>) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const id = useId();
  if (!open) {
    return (
      <button type="button" className={styles.addWords} onClick={() => setOpen(true)}>
        Add a note
      </button>
    );
  }
  const submit = async () => {
    if (!raw.trim()) return;
    setSaving(true);
    const stored = await onAddWords(note, raw);
    setSaving(false);
    if (stored) setOpen(false);
  };
  return (
    <form
      className={styles.wordsForm}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className={styles.caption}>
        Your words, kept exactly as you write them (they cannot be changed later)
      </label>
      <textarea id={id} value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} maxLength={20000} autoFocus />
      <div className={styles.reviewRow}>
        <button type="submit" disabled={!raw.trim() || saving}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function NoteCard({ note, focused, earlier = false, onReveal, onCite, onColor, onAddWords, onDelete, onReview }: NoteCardProps) {
  const [confirming, setConfirming] = useState(false);
  const structured = note.structured;
  const showStructured = structured !== null && structured.review !== 'rejected';

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
        <button type="button" className={styles.where} onClick={() => onReveal(note)} disabled={note.detached}>
          {note.target === 'source' ? anchorLabel(note.anchor) : `${PANE_WORDS[note.target]}, ${anchorLabel(note.anchor)}`}
        </button>
        <time className={styles.when} dateTime={note.created_at}>
          {new Date(note.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </time>
      </header>

      {note.passage ? <blockquote className={styles.passage}>{note.passage}</blockquote> : null}
      {earlier && !note.detached ? (
        <p className={styles.earlier}>On an earlier version of the {note.target === 'chapter_summary' ? 'summary' : 'distillation'}.</p>
      ) : null}

      <div className={showStructured ? styles.sideBySide : undefined}>
        <div className={styles.raw}>
          {note.raw === null ? (
            <>
              <p className={styles.caption}>Highlight</p>
              <AddWords note={note} onAddWords={onAddWords} />
            </>
          ) : (
            <>
              <p className={styles.caption}>Your words</p>
              <p className={styles.rawText}>{note.raw}</p>
            </>
          )}
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
