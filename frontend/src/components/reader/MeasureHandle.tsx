/**
 * The grip on the text column's edge, shown while exactly one side pane is open:
 * drag it to set how wide the text runs, arrow keys nudge it, a double click (or
 * Enter) goes back to the width preset. While dragging, the width is written
 * straight to the reader's custom property so a chapter's blocks don't re-render
 * per frame; it is saved once, on release, capped at the room the grid gave it.
 */
import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { clampMeasure, dragMeasure, MIN_MEASURE } from './layout';
import styles from './MeasureHandle.module.css';

export interface MeasureHandleProps {
  /** The text column, measured for its edge and the width it actually got. */
  column: RefObject<HTMLElement | null>;
  /** The element carrying `--reader-measure`. */
  root: RefObject<HTMLElement | null>;
  /** True when the column is centred (no pane beside it). */
  centred: boolean;
  /** The width in force, px. */
  width: number;
  onChange: (measure: number | null) => void;
}

const STEP = 16;

export function MeasureHandle({ column, root, centred, width, onChange }: MeasureHandleProps) {
  /** `grab`: how far right of the column's edge the pointer went down, kept so the edge doesn't jump to the pointer. */
  const drag = useRef<{ origin: number; grab: number; measure: number } | null>(null);

  /** Never store more than the grid could give: a width past the room left would make the grip dead until dragged back. */
  const settle = (measure: number) => {
    const actual = column.current?.getBoundingClientRect().width ?? 0;
    onChange(actual > 0 && measure > actual + 1 ? clampMeasure(actual) : measure);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const rect = column.current?.getBoundingClientRect();
    if (!rect || event.button !== 0) return;
    event.preventDefault();
    drag.current = { origin: centred ? rect.left + rect.width / 2 : rect.left, grab: event.clientX - rect.right, measure: width };
    root.current?.setAttribute('data-resizing', '');

    const onMove = (e: globalThis.PointerEvent) => {
      if (!drag.current) return;
      drag.current.measure = dragMeasure(e.clientX - drag.current.grab, drag.current.origin, centred);
      root.current?.style.setProperty('--reader-measure', `${drag.current.measure}px`);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      root.current?.removeAttribute('data-resizing');
      if (drag.current) settle(drag.current.measure);
      drag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onChange(null);
      return;
    }
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    // Stop the document shortcuts from reading the arrow too.
    event.stopPropagation();
    settle(clampMeasure(width + direction * STEP * (event.shiftKey ? 4 : 1)));
  };

  return (
    <div
      className={styles.measureHandle}
      role="separator"
      aria-orientation="vertical"
      aria-label="Text width"
      aria-valuemin={MIN_MEASURE}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width / 16)} rem wide`}
      title="Drag to set the text width · double-click to reset"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(null)}
      onKeyDown={onKeyDown}
    >
      <span className={styles.measureGrip} aria-hidden="true" />
    </div>
  );
}
