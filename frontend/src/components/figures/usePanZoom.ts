/**
 * `usePanZoom` — pointer, wheel and pinch input for the lightbox stage, on top of
 * the pure geometry in zoom.ts. Wheel (or trackpad pinch) zooms about the pointer,
 * one finger or the mouse pans a zoomed figure, two fingers pinch, a double click or
 * double tap toggles between fit and 2×. A tap on the empty stage while fitted is
 * reported as `onDismiss`. The view resets to fit whenever `resetKey` changes.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { clampView, fitView, isZoomed, panBy, toggleZoom, wheelFactor, zoomAt, type Point, type Size, type View } from './zoom';

const TAP_SLOP = 5;
const DOUBLE_TAP_MS = 300;

export interface PanZoom {
  view: View;
  stage: Size;
  zoomed: boolean;
  /** True while a gesture is in progress: render without easing. */
  live: boolean;
  zoomBy: (factor: number) => void;
  pan: (dx: number, dy: number) => void;
  fit: () => void;
  actualSize: () => void;
}

export function usePanZoom(stageRef: RefObject<HTMLElement | null>, natural: Size | null, resetKey: string, onDismiss: () => void): PanZoom {
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [live, setLive] = useState(false);
  // Read by listeners attached once.
  const state = useRef({ view, stage, natural, onDismiss });
  state.current = { view, stage, natural, onDismiss };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stageRef]);

  // A new figure, or its size (or the stage's) just became known: fit it. Later stage resizes keep the view, clamped, below.
  const fitKey = `${resetKey}|${natural?.width ?? 0}x${natural?.height ?? 0}|${stage.width > 0}`;
  const fitted = useRef('');
  useEffect(() => {
    const { natural: n, stage: s } = state.current;
    if (!n || s.width === 0 || fitted.current === fitKey) return;
    fitted.current = fitKey;
    setView(fitView(n, s));
  }, [fitKey]);

  useEffect(() => {
    if (natural && stage.width > 0) setView((v) => clampView(v, natural, stage));
  }, [stage, natural]);

  /** A point in stage coordinates, relative to the stage centre. */
  const local = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
    },
    [stageRef],
  );

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const pointers = new Map<number, Point>();
    let moved = false;
    let downAt: Point = { x: 0, y: 0 };
    let downOnStage = false;
    let lastTap = 0;
    let pinch: { distance: number; mid: Point } | null = null;
    let idle = 0;

    const update = (next: (v: View, n: Size, s: Size) => View) => {
      const { natural: n, stage: s } = state.current;
      if (n) setView((v) => next(v, n, s));
    };
    const settle = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setLive(false), 120);
    };
    const pinchOf = (): { distance: number; mid: Point } | null => {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return null;
      return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setLive(true);
      const at = local(event.clientX, event.clientY);
      update((v, n, s) => zoomAt(v, wheelFactor(event.deltaY, event.deltaMode), at, n, s));
      settle();
    };
    const onDown = (event: PointerEvent) => {
      // Buttons on the stage (previous / next) keep their own clicks: capturing would steal them.
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, a'))) return;
      el.setPointerCapture?.(event.pointerId);
      downAt = local(event.clientX, event.clientY);
      pointers.set(event.pointerId, downAt);
      moved = pointers.size > 1;
      downOnStage = event.target === el;
      pinch = pinchOf();
      setLive(true);
    };
    const onMove = (event: PointerEvent) => {
      const before = pointers.get(event.pointerId);
      if (!before) return;
      const now = local(event.clientX, event.clientY);
      pointers.set(event.pointerId, now);
      if (pointers.size > 1 || Math.hypot(now.x - downAt.x, now.y - downAt.y) > TAP_SLOP) moved = true;
      if (pointers.size >= 2) {
        const next = pinchOf();
        if (pinch && next && pinch.distance > 0) {
          const { distance, mid } = pinch;
          update((v, n, s) => panBy(zoomAt(v, next.distance / distance, mid, n, s), next.mid.x - mid.x, next.mid.y - mid.y, n, s));
        }
        pinch = next;
      } else {
        update((v, n, s) => panBy(v, now.x - before.x, now.y - before.y, n, s));
      }
    };
    const onUp = (event: PointerEvent) => {
      const at = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      pinch = pinchOf();
      if (pointers.size > 0) return;
      settle();
      if (moved || !at) return;
      const { view: v, natural: n, stage: s } = state.current;
      if (event.pointerType === 'touch') {
        const now = event.timeStamp;
        if (now - lastTap < DOUBLE_TAP_MS) {
          lastTap = 0;
          update((cur, nn, ss) => toggleZoom(cur, at, nn, ss));
          return;
        }
        lastTap = now;
      }
      if (downOnStage && n && !isZoomed(v, n, s)) state.current.onDismiss();
    };
    const onDouble = (event: MouseEvent) => {
      const at = local(event.clientX, event.clientY);
      update((v, n, s) => toggleZoom(v, at, n, s));
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDouble);
    return () => {
      window.clearTimeout(idle);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', onDouble);
    };
  }, [stageRef, local]);

  const zoomBy = useCallback((factor: number) => update(setView, natural, stage, (v, n, s) => zoomAt(v, factor, { x: 0, y: 0 }, n, s)), [natural, stage]);
  const pan = useCallback((dx: number, dy: number) => update(setView, natural, stage, (v, n, s) => panBy(v, dx, dy, n, s)), [natural, stage]);
  const fit = useCallback(() => update(setView, natural, stage, (_v, n, s) => fitView(n, s)), [natural, stage]);
  const actualSize = useCallback(() => update(setView, natural, stage, (v, n, s) => zoomAt(v, 1 / v.scale, { x: 0, y: 0 }, n, s)), [natural, stage]);

  return { view, stage, zoomed: natural ? isZoomed(view, natural, stage) : false, live, zoomBy, pan, fit, actualSize };
}

function update(set: (fn: (v: View) => View) => void, natural: Size | null, stage: Size, next: (v: View, n: Size, s: Size) => View) {
  if (natural && stage.width > 0) set((v) => next(v, natural, stage));
}
