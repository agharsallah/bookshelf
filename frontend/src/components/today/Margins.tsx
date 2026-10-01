/**
 * From your margins (island, on Today): one passage you marked, brought back so it stays
 * with you. It is the same passage all day; "Show another" draws a different one from
 * your notes. The passage sits on a sheet in the book's voice, your highlighter laid
 * across it again as it appears, your own words under it, and a way back to its place.
 */
import { useState } from 'react';
import { anchorLabel } from '../../lib/anchors';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { Page } from '../../lib/api/types';
import type { NoteDetail } from '../../lib/api/types/notes';
import { problemOf } from '../common/Problem';
import { toast } from '../document/toast';
import { markedWhen, marginNotes, NOTE_WINDOW, shortTitle, type BookIndex, type MarginNote } from './today';
import styles from './Margins.module.css';

export interface MarginsProps {
  initial: MarginNote | null;
  /** Every note you made, so "Show another" only shows when there is another. */
  total: number;
  books: BookIndex;
  /** Now, as an ISO timestamp, for "Marked 3 days ago". */
  now: string;
  api?: Pick<ApiClient, 'get'>;
  /** 0–1, for which notes "Show another" reads; Math.random unless a test fixes it. */
  random?: () => number;
}

export function Margins({ initial, total, books, now, api = browserApi, random = Math.random }: MarginsProps) {
  const [note, setNote] = useState(initial);
  const [busy, setBusy] = useState(false);

  const another = async () => {
    setBusy(true);
    try {
      const offset = Math.floor(random() * Math.max(1, total - NOTE_WINDOW + 1));
      const page = await api.get<Page<NoteDetail>>('notes', { query: { limit: NOTE_WINDOW, offset } });
      const choices = marginNotes(page.items, books, note?.id);
      const next = choices[Math.floor(random() * choices.length)];
      if (next) setNote(next);
      else toast('No other passage to show yet.', 'info');
    } catch (error) {
      toast(`Another passage could not be loaded: ${problemOf(error).message}`, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.margins} aria-labelledby="margins-title">
      <div className={styles.head}>
        <h2 id="margins-title" className="section-title">
          From your margins
        </h2>
        {note && total > 1 && (
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void another()}>
            Show another
          </button>
        )}
      </div>
      {note ? (
        // A new key lays the stroke again for each passage.
        <figure key={note.id} className={styles.sheet} aria-live="polite">
          <blockquote className={styles.passage}>
            <p>
              <mark className={styles.mark} data-color={note.color ?? undefined}>
                {note.passage}
              </mark>
            </p>
          </blockquote>
          {note.raw && (
            <p className={styles.yours}>
              <span className="visually-hidden">Your note: </span>
              {note.raw}
            </p>
          )}
          <figcaption className={styles.source}>
            <span className={styles.where}>
              {markedWhen(note.created_at, now)} in <cite className="book-title">{shortTitle(note.book.title)}</cite>, at {anchorLabel(note.anchor)}
            </span>
            <a className="btn" href={`/documents/${note.book.slug}/read/${note.anchor}`}>
              Open in the book
            </a>
          </figcaption>
        </figure>
      ) : (
        <p className={styles.none}>
          Passages you highlight while reading come back here, one each day, so they stay with you.
        </p>
      )}
    </section>
  );
}

export default Margins;
