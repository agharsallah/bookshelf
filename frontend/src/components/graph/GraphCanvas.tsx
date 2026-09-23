/**
 * The canvas view of one neighbourhood. A thin React shell around `GraphController`:
 * it sizes the canvas to its box (devicePixelRatio-aware), passes data down and
 * selections up. The canvas is presentational for assistive tech; the synchronized
 * list (`NeighborhoodList`) is the accessible view of the same data.
 */
import { useEffect, useRef } from 'react';
import { GraphController, type Selection } from './controller';
import type { GraphModel } from './model';
import { useGraphPalette } from './palette';
import styles from './Graph.module.css';

export interface GraphCanvasProps {
  model: GraphModel;
  selected: Selection;
  highlight: string | null;
  reducedMotion: boolean;
  onSelect: (selection: Selection) => void;
  onFocusRequest: (id: string) => void;
  label: string;
}

export function GraphCanvas({ model, selected, highlight, reducedMotion, onSelect, onFocusRequest, label }: GraphCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<GraphController | null>(null);
  const palette = useGraphPalette(box);
  const handlers = useRef({ onSelect, onFocusRequest });
  handlers.current = { onSelect, onFocusRequest };

  useEffect(() => {
    const el = canvas.current;
    const host = box.current;
    if (!el || !host) return;
    const ctl = new GraphController(el, {
      onSelect: (s) => handlers.current.onSelect(s),
      onFocusRequest: (id) => handlers.current.onFocusRequest(id),
    });
    controller.current = ctl;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      ctl.resize(width, height, window.devicePixelRatio || 1);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      ctl.destroy();
      controller.current = null;
    };
  }, []);

  useEffect(() => controller.current?.setPalette(palette), [palette]);
  useEffect(() => controller.current?.setModel(model, reducedMotion), [model, reducedMotion]);
  useEffect(() => controller.current?.setSelected(selected), [selected]);
  useEffect(() => controller.current?.setHighlight(highlight), [highlight]);

  return (
    <div ref={box} className={styles.canvasBox}>
      <canvas ref={canvas} className={styles.canvas} role="img" aria-label={label} />
      <div className={styles.zoom} role="group" aria-label="Zoom">
        <button type="button" onClick={() => controller.current?.zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => controller.current?.zoomBy(0.8)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => controller.current?.resetView()} aria-label="Fit to view">
          Fit
        </button>
      </div>
    </div>
  );
}
