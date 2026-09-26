/**
 * The map as a list: the accessible, keyboard-first view of what the canvas shows.
 * Each book with its chapters, then the concepts by how connected they are. Anything the
 * lens dims is marked as such; with "hide" it is not listed. ↑/↓ move, Enter selects,
 * and focusing an entry lights it on the canvas.
 */
import { useRef, type KeyboardEvent } from 'react';
import type { AtlasNode } from '../../lib/api/types/graph';
import type { Lens } from '../graph/draw';
import { KindMark } from '../graph/Legend';
import type { AtlasModel } from './model';
import graph from '../graph/Graph.module.css';
import styles from './Atlas.module.css';

export interface AtlasListProps {
  model: AtlasModel;
  lens: Lens | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onHighlight: (id: string | null) => void;
}

export function AtlasList({ model, lens, selected, onSelect, onHighlight }: AtlasListProps) {
  const root = useRef<HTMLDivElement>(null);
  const nodes = model.nodes.map((n) => n.data);
  const books = nodes.filter((n) => n.kind === 'document');
  const chaptersOf = (book: AtlasNode) =>
    nodes.filter((n) => n.kind === 'chapter' && n.document?.id === book.document?.id).sort((a, b) => a.ordinal - b.ordinal);
  const concepts = nodes.filter((n) => n.kind === 'concept').sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('button[data-item]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const item = (n: AtlasNode, note?: string) => {
    const dimmed = lens !== null && !lens.nodes.has(n.id);
    return (
      <li key={n.id}>
        <button
          type="button"
          data-item
          className={`${graph.listNode} ${dimmed ? styles.dimmed : ''}`}
          aria-pressed={selected === n.id}
          onClick={() => onSelect(n.id)}
          onFocus={() => onHighlight(n.id)}
          onBlur={() => onHighlight(null)}
        >
          <KindMark kind={n.kind === 'chapter' ? 'node' : n.kind} />
          <span className={`${graph.listLabel} ${n.kind === 'concept' ? styles.italic : ''}`}>{n.label}</span>
          {note ? <span className={graph.listMore}>{note}</span> : null}
          {dimmed ? <span className={styles.srOnly}> (outside the lens)</span> : null}
        </button>
      </li>
    );
  };

  return (
    <div ref={root} className={graph.list} onKeyDown={onKey}>
      {books.map((book) => (
        <section key={book.id} aria-label={book.label}>
          <h3 className={graph.ringHead}>{book.label}</h3>
          <ul className={graph.ringList}>
            {item(book)}
            {chaptersOf(book).map((c) => item(c, `${c.degree} links`))}
          </ul>
        </section>
      ))}
      {concepts.length ? (
        <section aria-label="Concepts">
          <h3 className={graph.ringHead}>Concepts</h3>
          <ul className={graph.ringList}>{concepts.map((c) => item(c, c.books > 1 ? `${c.books} books` : `${c.degree} links`))}</ul>
        </section>
      ) : null}
    </div>
  );
}
