/**
 * A grip on a column's moving edge: drag it to set how wide the column runs, arrow
 * keys nudge it, a double click (or Enter) goes back to the default. The reader's text
 * column uses it while a side pane is open; the book guide's passage drawer uses it on
 * its left edge. While dragging, the width is written straight to a custom property so
 * a chapter's blocks don't re-render per frame; it is saved once, on release, capped
 * at the room the layout gave it.
 */
import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { clampMeasure, dragMeasure, MIN_MEASURE, type MeasureAnchor } from './layout';
import styles from './MeasureHandle.module.css';

export interface MeasureHandleProps {
  /** The column, measured for its edges and the width it actually got. */
  column: RefObject<HTMLElement | null>;
  /** The element carrying `property`. */
  root: RefObject<HTMLElement | null>;
  /** What stays put: the column's start (grip on its end edge), centre, or end (grip on its start edge). */
  anchor: MeasureAnchor;
  /** The width in force, px. */
  width: number;
  onChange: (measure: number | null) => void;
  /** The custom property the width is written to while dragging. */
  property?: string;
  /** What is being sized, for assistive tech and the tooltip. */
  label?: string;
}

const STEP = 16;

export function MeasureHandle({ column, root, anchor, width, onChange, property = '--reader-measure', label = 'Text width' }: MeasureHandleProps) {
  /** The grip sits on the edge that moves: the start edge when the column is pinned at its end. */
  const edge = anchor === 'end' ? 'start' : 'end';
  /** `grab`: how far past the moving edge the pointer went down, kept so the edge doesn't jump to the pointer. */
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
    const origin = anchor === 'centre' ? rect.left + rect.width / 2 : anchor === 'end' ? rect.right : rect.left;
    drag.current = { origin, grab: event.clientX - (edge === 'start' ? rect.left : rect.right), measure: width };
    root.current?.setAttribute('data-resizing', '');

    const onMove = (e: globalThis.PointerEvent) => {
      if (!drag.current) return;
      drag.current.measure = dragMeasure(e.clientX - drag.current.grab, drag.current.origin, anchor);
      root.current?.style.setProperty(property, `${drag.current.measure}px`);
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
    // The arrow that moves the grip outward widens: right on an end edge, left on a start edge.
    const outward = edge === 'start' ? 'ArrowLeft' : 'ArrowRight';
    const inward = edge === 'start' ? 'ArrowRight' : 'ArrowLeft';
    const direction = event.key === outward ? 1 : event.key === inward ? -1 : 0;
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
      aria-label={label}
      data-edge={edge}
      aria-valuemin={MIN_MEASURE}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width / 16)} rem wide`}
      title={`Drag to set the ${label.toLowerCase()} · double-click to reset`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(null)}
      onKeyDown={onKeyDown}
    >
      <span className={styles.measureGrip} aria-hidden="true" />
    </div>
  );
}
