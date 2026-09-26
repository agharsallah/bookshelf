/**
 * The canvas view of a graph model (a neighbourhood, or the map). A thin React shell
 * around `GraphController`:
 * it sizes the canvas to its box (devicePixelRatio-aware), passes data down and
 * selections up. The canvas is presentational for assistive tech; the synchronized
 * list (`NeighborhoodList`) is the accessible view of the same data.
 */
import { useEffect, useRef } from 'react';
import { GraphController, NEIGHBOURHOOD_KIT, type LayoutKit, type Selection } from './controller';
import type { Lens, Trail } from './draw';
import type { GraphModel } from './model';
import { useGraphPalette } from './palette';
import styles from './Graph.module.css';

export interface GraphCanvasProps {
  model: GraphModel<unknown, unknown>;
  selected: Selection;
  highlight: string | null;
  reducedMotion: boolean;
  onSelect: (selection: Selection) => void;
  onFocusRequest: (id: string) => void;
  label: string;
  /** How the picture is laid out and framed; the neighbourhood's rings by default. */
  kit?: LayoutKit;
  /** What stays lit; the rest is drawn faint. */
  lens?: Lens | null;
  /** Glide to this node; a new object glides again, even to the same node. */
  glide?: { id: string } | null;
  /** A path to trace hop by hop and frame; a new array traces it again. */
  trail?: Trail['hops'] | null;
}

export function GraphCanvas({
  model,
  selected,
  highlight,
  reducedMotion,
  onSelect,
  onFocusRequest,
  label,
  kit = NEIGHBOURHOOD_KIT,
  lens = null,
  glide = null,
  trail = null,
}: GraphCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<GraphController | null>(null);
  const palette = useGraphPalette(box);
  const handlers = useRef({ onSelect, onFocusRequest });
  handlers.current = { onSelect, onFocusRequest };
  const firstKit = useRef(kit);

  useEffect(() => {
    const el = canvas.current;
    const host = box.current;
    if (!el || !host) return;
    const ctl = new GraphController(
      el,
      {
        onSelect: (s) => handlers.current.onSelect(s),
        onFocusRequest: (id) => handlers.current.onFocusRequest(id),
      },
      firstKit.current,
    );
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
  useEffect(() => controller.current?.setKit(kit), [kit]);
  useEffect(() => controller.current?.setModel(model, reducedMotion), [model, reducedMotion]);
  useEffect(() => controller.current?.setSelected(selected), [selected]);
  useEffect(() => controller.current?.setHighlight(highlight), [highlight]);
  useEffect(() => controller.current?.setLens(lens), [lens]);
  useEffect(() => {
    if (glide) controller.current?.glideTo(glide.id);
  }, [glide]);
  useEffect(() => {
    controller.current?.setTrail(trail);
    if (trail?.length) controller.current?.frameNodes(trail.flatMap((h) => [h.from, h.to]));
  }, [trail]);

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
