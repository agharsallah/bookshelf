/**
 * The floating toolbar over a text selection (five highlighter colours and "Note"),
 * and the note composer it opens. Positioned in viewport coordinates; the reader
 * decides where. What you type is saved verbatim as the note's `raw` (D11).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../lib/contract';
import styles from './NoteComposer.module.css';

export interface ComposerTarget {
  anchor: string;
  /** Null for a whole-block note (keyboard `n` without a selection). */
  range: { start: number; end: number } | null;
  /** The selected passage, shown as the quote. */
  passage: string;
  /** Viewport coordinates to place the toolbar at (centre-bottom of the selection). */
  x: number;
  y: number;
}

export interface NoteComposerProps {
  target: ComposerTarget;
  startComposing?: boolean;
  saving: boolean;
  onHighlight: (color: HighlightColor) => void;
  onSave: (raw: string, color: HighlightColor) => void;
  onClose: () => void;
}

export function NoteComposer({ target, startComposing = false, saving, onHighlight, onSave, onClose }: NoteComposerProps) {
  const [composing, setComposing] = useState(startComposing);
  const [raw, setRaw] = useState('');
  const [color, setColor] = useState<HighlightColor>('amber');
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (composing) area.current?.focus();
  }, [composing]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && raw.trim()) {
      onSave(raw, color);
    }
  };

  const style = {
    left: `clamp(0.75rem, ${target.x}px - 9rem, calc(100vw - 18.75rem))`,
    top: `${target.y + 10}px`,
  };

  if (!composing) {
    return (
      <div className={styles.toolbar} style={style} role="toolbar" aria-label="Highlight the selection" onKeyDown={onKey}>
        {target.range
          ? HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.swatch}
                data-color={c}
                aria-label={`Highlight ${c}`}
                title={`Highlight ${c}`}
                disabled={saving}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onHighlight(c)}
              />
            ))
          : null}
        <button
          type="button"
          className={styles.noteButton}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setComposing(true)}
        >
          Note
        </button>
      </div>
    );
  }

  return (
    <form
      className={styles.composer}
      style={style}
      aria-label="New note"
      onKeyDown={onKey}
      onSubmit={(e) => {
        e.preventDefault();
        if (raw.trim()) onSave(raw, color);
      }}
    >
      {target.passage ? <blockquote className={styles.passage}>{target.passage}</blockquote> : null}
      <label className={styles.label} htmlFor="note-raw">
        Your note, kept exactly as you write it
      </label>
      <textarea
        id="note-raw"
        ref={area}
        className={styles.area}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={4}
        maxLength={20000}
      />
      <div className={styles.row}>
        <div className={styles.colors} role="radiogroup" aria-label="Colour">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              className={styles.swatch}
              data-color={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button type="button" className={styles.quiet} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={styles.save} disabled={!raw.trim() || saving}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </form>
  );
}
