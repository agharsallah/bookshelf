/**
 * Add a cite by typing: a combobox that suggests the scope's blocks by anchor or by the
 * words they contain. Enter picks the highlighted suggestion (or a typed anchor).
 */
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { anchorLabel } from '../../../lib/anchors';
import type { SourceBlock } from '../api';
import { ANCHOR_PATTERN } from './validate';
import styles from './Editor.module.css';

const LIMIT = 8;

/** Blocks matching the query by anchor prefix first, then by text. Pure, for tests. */
export function suggestAnchors(blocks: readonly SourceBlock[], query: string, exclude: readonly string[] = []): SourceBlock[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const open = blocks.filter((b) => !exclude.includes(b.anchor));
  const byAnchor = open.filter((b) => b.anchor.startsWith(q));
  const byText = open.filter((b) => !b.anchor.startsWith(q) && (b.text ?? b.heading ?? '').toLowerCase().includes(q));
  return [...byAnchor, ...byText].slice(0, LIMIT);
}

export interface CitePickerProps {
  blocks: readonly SourceBlock[];
  exclude: readonly string[];
  onPick: (anchor: string) => void;
  label?: string;
}

export function CitePicker({ blocks, exclude, onPick, label = 'Add a cite' }: CitePickerProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputId = useId();
  const options = useMemo(() => suggestAnchors(blocks, query, exclude), [blocks, query, exclude]);
  const open = options.length > 0;

  const pick = (anchor: string) => {
    onPick(anchor);
    setQuery('');
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && open) {
      event.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = options[active]?.anchor ?? (ANCHOR_PATTERN.test(query.trim()) ? query.trim() : null);
      if (chosen) pick(chosen);
    } else if (event.key === 'Escape') {
      setQuery('');
    }
  };

  return (
    <div className={styles.picker}>
      <label htmlFor={inputId} className="visually-hidden">
        {label}
      </label>
      <input
        id={inputId}
        className={styles.pickerInput}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        placeholder="+ cite (anchor or words)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      {open ? (
        <ul id={listId} role="listbox" className={styles.options} aria-label="Matching passages">
          {options.map((block, i) => (
            <li
              key={block.anchor}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(block.anchor);
              }}
            >
              <span className={styles.optionAnchor}>{anchorLabel(block.anchor)}</span>
              <span className={styles.optionText}>{(block.text ?? block.heading ?? '').slice(0, 90)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
