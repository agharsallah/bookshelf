/** Passages as quotes: the block's opening words, linked into the reader, and how you spent time on it. */
import type { PassageRow } from '../../lib/api/types/readerStats';
import { formatTime, plural } from './format';
import { readHref } from './model';
import styles from './You.module.css';

export function Passages({ passages, empty, showBook = true }: { passages: readonly PassageRow[]; empty: string; showBook?: boolean }) {
  if (passages.length === 0) return <p className={styles.panelLede}>{empty}</p>;
  return (
    <ol className={styles.passages}>
      {passages.map((p) => (
        <li key={`${p.document}:${p.anchor}`} className={styles.passage}>
          <blockquote className={styles.quote}>
            <a href={readHref(p.document, p.anchor)}>{p.text ? `${p.text}${p.text.length >= 200 ? '…' : ''}` : p.anchor}</a>
          </blockquote>
          <p className={styles.passageMeta}>
            {p.seconds > 0 ? (
              <span>
                <strong>{formatTime(p.seconds)}</strong> on it
              </span>
            ) : null}
            {p.visits > 0 ? <span>{plural(p.visits, 'day')}</span> : null}
            {p.notes > 0 ? <span>{plural(p.notes, 'note')}</span> : null}
            <span>{showBook ? `${p.book_title} · ${p.chapter}` : p.chapter}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}
