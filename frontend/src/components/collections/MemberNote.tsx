/**
 * The note on why a document is in a collection: shown as text, edited in place. An empty
 * note is saved as none.
 */
import { useState } from 'react';
import styles from './Collections.module.css';

export interface MemberNoteProps {
  note: string | null;
  /** The document's title, for labels. */
  title: string;
  onSave: (note: string | null) => Promise<void>;
}

export function MemberNote({ note, title, onSave }: MemberNoteProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');

  if (!editing) {
    return (
      <div className={styles.note}>
        {note && <p>{note}</p>}
        <button
          type="button"
          className={styles.link}
          onClick={() => {
            setDraft(note ?? '');
            setEditing(true);
          }}
        >
          {note ? 'Edit note' : 'Add a note'}
        </button>
      </div>
    );
  }

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setEditing(false);
    await onSave(draft.trim() || null);
  };

  return (
    <form className={styles.note} onSubmit={(e) => void submit(e)}>
      <label>
        <span className="visually-hidden">Why {title} is here</span>
        <textarea value={draft} maxLength={2000} rows={2} autoFocus onChange={(e) => setDraft(e.target.value)} />
      </label>
      <span className={styles.noteActions}>
        <button type="submit" className="btn">
          Save note
        </button>
        <button type="button" className={styles.link} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </span>
    </form>
  );
}
