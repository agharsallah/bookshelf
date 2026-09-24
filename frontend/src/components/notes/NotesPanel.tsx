/**
 * Your notes, for this chapter or the whole book. Notes are listed in reading order
 * (a chapter's distillation and summary notes first), grouped by chapter for the
 * whole book, then any detached ones (what they marked no longer exists after a
 * re-parse, so they cannot be shown in place).
 */
import type { NoteDetail } from '../../lib/api/types/notes';
import type { HighlightColor } from '../../lib/contract';
import { isUnder } from '../../lib/documents/tree';
import { NoteCard } from './NoteCard';
import styles from './NotesPanel.module.css';

export type NotesScope = 'chapter' | 'book';

export interface NotesUnit {
  anchor: string;
  heading: string;
}

export interface NotesPanelProps {
  /** Every note in the book; the panel narrows it to the chapter on `scope: 'chapter'`. */
  notes: readonly NoteDetail[];
  /** The chapter being read, and every chapter in reading order. */
  unit: string;
  units: readonly NotesUnit[];
  scope: NotesScope;
  onScope: (scope: NotesScope) => void;
  /** Anchor → reading position in this chapter, for ordering. */
  order: ReadonlyMap<string, number>;
  /** Artifacts the pane shows now: a pane note on any other version is on an earlier one. */
  currentArtifacts: ReadonlySet<string>;
  focusedId: string | null;
  onReveal: (note: NoteDetail) => void;
  onCite: (anchor: string) => void;
  onColor: (note: NoteDetail, color: HighlightColor) => void;
  onAddWords: (note: NoteDetail, raw: string) => Promise<boolean>;
  onDelete: (note: NoteDetail) => void;
  onReview: (note: NoteDetail, action: 'approve' | 'reject') => void;
}

/** Reading order: by position in the chapter when known, else by anchor; then by where the range starts. */
export function sortNotes(notes: readonly NoteDetail[], order: ReadonlyMap<string, number>): NoteDetail[] {
  const at = (n: NoteDetail) => order.get(n.anchor) ?? Number.MAX_SAFE_INTEGER;
  return [...notes].sort(
    (a, b) =>
      at(a) - at(b) ||
      a.anchor.localeCompare(b.anchor, 'en', { numeric: true }) ||
      (a.block ?? -1) - (b.block ?? -1) ||
      (a.range?.start ?? -1) - (b.range?.start ?? -1) ||
      a.created_at.localeCompare(b.created_at),
  );
}

export interface NotesGroup {
  unit: NotesUnit | null;
  notes: NoteDetail[];
}

/** Notes per chapter, in reading order; notes under no known chapter come last, unlabelled. */
export function groupByUnit(notes: readonly NoteDetail[], units: readonly NotesUnit[], order: ReadonlyMap<string, number>): NotesGroup[] {
  const groups: NotesGroup[] = units.map((unit) => ({ unit, notes: [] }));
  const rest: NoteDetail[] = [];
  for (const note of notes) {
    const group = groups.find((g) => g.unit && isUnder(note.anchor, g.unit.anchor));
    (group ? group.notes : rest).push(note);
  }
  return [...groups, { unit: null, notes: rest }]
    .filter((g) => g.notes.length > 0)
    .map((g) => ({ ...g, notes: sortNotes(g.notes, order) }));
}

export function NotesPanel({ notes, unit, units, scope, onScope, order, currentArtifacts, focusedId, ...handlers }: NotesPanelProps) {
  const inChapter = notes.filter((n) => isUnder(n.anchor, unit));
  const shown = scope === 'chapter' ? inChapter : notes;
  const attached = shown.filter((n) => !n.detached);
  const detached = shown.filter((n) => n.detached);
  const earlier = (n: NoteDetail) => n.target !== 'source' && n.artifact_id !== null && !currentArtifacts.has(n.artifact_id);
  const card = (note: NoteDetail) => (
    <NoteCard key={note.id} note={note} focused={note.id === focusedId} earlier={earlier(note)} {...handlers} />
  );

  const switcher = (
    <div className={styles.scope} role="radiogroup" aria-label="Show notes from">
      {(
        [
          ['chapter', 'This chapter', inChapter.length],
          ['book', 'Whole book', notes.length],
        ] as const
      ).map(([value, label, count]) => (
        <button key={value} type="button" role="radio" aria-checked={scope === value} onClick={() => onScope(value)}>
          {label} <span className={styles.scopeCount}>{count}</span>
        </button>
      ))}
    </div>
  );

  if (shown.length === 0) {
    return (
      <div className={styles.panel}>
        {switcher}
        <div className={styles.empty}>
          <p>{scope === 'chapter' ? 'No notes in this chapter yet.' : 'No notes in this book yet.'}</p>
          <p>
            Select a passage of the text, the distillation or the summary to highlight it or write a note, or focus a block and press <kbd>n</kbd>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {switcher}
      {scope === 'chapter'
        ? sortNotes(attached, order).map(card)
        : groupByUnit(attached, units, order).map((group) => (
            <section key={group.unit?.anchor ?? '~'} className={styles.group} aria-label={group.unit?.heading ?? 'Elsewhere'}>
              <h3 className={styles.groupTitle} data-current={group.unit?.anchor === unit ? '' : undefined}>
                {group.unit?.heading ?? 'Elsewhere'}
              </h3>
              {group.notes.map(card)}
            </section>
          ))}
      {detached.length > 0 ? (
        <section className={styles.detached} aria-labelledby="detached-title">
          <h3 id="detached-title">Detached notes</h3>
          <p className={styles.detachedHint}>
            What these notes marked changed when the document was parsed or distilled again. Your words are kept.
          </p>
          {detached.map(card)}
        </section>
      ) : null}
    </div>
  );
}
