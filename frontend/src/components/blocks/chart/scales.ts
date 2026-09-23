/**
 * Minimal, pure scale helpers for the native SVG chart block. No d3-scale: the chart
 * needs linear, band and point scales and "nice" ticks, nothing more.
 */

export type Range = readonly [number, number];

/** A tick step of 1, 2 or 5 × 10^k that yields roughly `count` intervals over `span`. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || count < 1) return 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1;
  return factor * magnitude;
}

/** Round a float to the step's precision so ticks print as 0.3, not 0.30000000000000004. */
function roundTo(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(value.toFixed(decimals));
}

/** Expand [min, max] outward to whole steps and list the ticks. A flat domain gets padded. */
export function niceDomain(min: number, max: number, count = 5): { domain: [number, number]; ticks: number[] } {
  let lo = min;
  let hi = max;
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.5;
    lo -= pad;
    hi += pad;
    if (min === 0) lo = 0;
  }
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let i = 0; start + i * step <= end + step / 2; i++) ticks.push(roundTo(start + i * step, step));
  return { domain: [roundTo(start, step), roundTo(end, step)], ticks };
}

/** Map a continuous domain onto a pixel range. */
export function linearScale(domain: Range, range: Range): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0));
}

export interface BandScale {
  /** Left edge of band `i`. */
  start: (index: number) => number;
  /** Center of band `i`. */
  center: (index: number) => number;
  bandwidth: number;
  step: number;
}

/** Evenly divide a range into `count` bands with inner/outer padding (fractions of a step). */
export function bandScale(count: number, range: Range, paddingInner = 0.3, paddingOuter = 0.15): BandScale {
  const [r0, r1] = range;
  const n = Math.max(1, count);
  const step = (r1 - r0) / (n - paddingInner + paddingOuter * 2);
  const bandwidth = step * (1 - paddingInner);
  const offset = r0 + step * paddingOuter;
  return {
    step,
    bandwidth,
    start: (index) => offset + index * step,
    center: (index) => offset + index * step + bandwidth / 2,
  };
}

/** Evenly spaced positions with half a step of air at each end (categorical line/scatter x). */
export function pointScale(count: number, range: Range): (index: number) => number {
  const [r0, r1] = range;
  const step = (r1 - r0) / Math.max(1, count);
  return (index) => r0 + step * (index + 0.5);
}

/** Min and max over every non-null value; optionally forced to include zero (bars must). */
export function valueExtent(
  series: readonly { values: readonly (number | null)[] }[],
  includeZero: boolean,
): [number, number] {
  let min = includeZero ? 0 : Infinity;
  let max = includeZero ? 0 : -Infinity;
  for (const s of series) {
    for (const v of s.values) {
      if (v === null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return Number.isFinite(min) ? [min, max] : [0, 1];
}

/** Index of the position closest to `x`. */
export function nearestIndex(positions: readonly number[], x: number): number {
  let best = 0;
  positions.forEach((p, i) => {
    if (Math.abs(p - x) < Math.abs((positions[best] ?? Infinity) - x)) best = i;
  });
  return best;
}
