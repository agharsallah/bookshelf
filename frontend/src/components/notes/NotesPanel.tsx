/**
 * The chapter's notes in reading order, then any detached ones (their passage no
 * longer exists after a re-parse, so they cannot be shown in place).
 */
import type { NoteDetail } from '../../lib/api/types/notes';
import type { HighlightColor } from '../../lib/contract';
import { NoteCard } from './NoteCard';
import styles from './NotesPanel.module.css';

export interface NotesPanelProps {
  notes: readonly NoteDetail[];
  /** Anchor → reading position, for ordering. */
  order: ReadonlyMap<string, number>;
  /** Anchor → the block's text, to quote the highlighted passage. */
  texts: ReadonlyMap<string, string>;
  focusedId: string | null;
  onReveal: (anchor: string) => void;
  onCite: (anchor: string) => void;
  onColor: (note: NoteDetail, color: HighlightColor) => void;
  onDelete: (note: NoteDetail) => void;
  onReview: (note: NoteDetail, action: 'approve' | 'reject') => void;
}

export function sortNotes(notes: readonly NoteDetail[], order: ReadonlyMap<string, number>): NoteDetail[] {
  const at = (n: NoteDetail) => order.get(n.anchor) ?? Number.MAX_SAFE_INTEGER;
  return [...notes].sort((a, b) => at(a) - at(b) || (a.range?.start ?? -1) - (b.range?.start ?? -1) || a.created_at.localeCompare(b.created_at));
}

export function NotesPanel({ notes, order, texts, focusedId, ...handlers }: NotesPanelProps) {
  const attached = sortNotes(notes.filter((n) => !n.detached), order);
  const detached = notes.filter((n) => n.detached);
  const passage = (n: NoteDetail) => {
    const text = texts.get(n.anchor);
    return text && n.range ? text.slice(n.range.start, n.range.end) : null;
  };

  if (notes.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No notes in this chapter yet.</p>
        <p>Select a passage on the left to highlight it or write a note, or focus a block and press <kbd>n</kbd>.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {attached.map((note) => (
        <NoteCard key={note.id} note={note} passage={passage(note)} focused={note.id === focusedId} {...handlers} />
      ))}
      {detached.length > 0 ? (
        <section className={styles.detached} aria-labelledby="detached-title">
          <h3 id="detached-title">Detached notes</h3>
          <p className={styles.detachedHint}>
            The passages these notes marked changed when the document was parsed again. Your words are kept.
          </p>
          {detached.map((note) => (
            <NoteCard key={note.id} note={note} passage={null} focused={note.id === focusedId} {...handlers} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
