/**
 * What every chart shares: series, the sequential ramp, margins, rounded bar ends and the
 * container width. Colors are theme tokens (`--series-*` in styles/tokens.css), so a chart
 * follows light and dark mode without knowing about them.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

export interface Series {
  key: string;
  label: string;
  /** A CSS color, usually `var(--series-n)`. */
  color: string;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Categorical slots in fixed order: an entity keeps its color whatever else is shown. */
export const SLOTS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'] as const;
export const OTHER = 'var(--series-other)';

/** The sequential ramp, one hue from the surface (0) to full `--series-1` (1). */
export function sequential(t: number, hue = 'var(--series-1)'): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped === 0) return 'var(--paper-sunken)';
  return `color-mix(in oklab, ${hue} ${Math.round(12 + clamped * 88)}%, var(--paper-raised))`;
}

/** Quantize 0–1 into `steps` levels (1..steps; 0 stays 0), so a heatmap reads in bands. */
export function level(value: number, max: number, steps = 5): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(1, Math.ceil((value / max) * steps)) / steps;
}

/** A bar with 4px rounded data end, square at its baseline (the bottom). */
export function columnPath(x: number, y: number, width: number, height: number, radius = 4): string {
  if (height <= 0 || width <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/** A horizontal bar with its data end (the right) rounded. */
export function barPath(x: number, y: number, width: number, height: number, radius = 4): string {
  if (height <= 0 || width <= 0) return '';
  const r = Math.min(radius, height / 2, width);
  return `M${x},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height - r}Q${x + width},${y + height} ${x + width - r},${y + height}H${x}Z`;
}

/** The element's content width, following resizes; `fallback` until it is measured (SSR). */
export function useWidth<T extends HTMLElement>(fallback = 640): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
