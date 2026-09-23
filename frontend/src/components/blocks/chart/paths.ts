/** Pure SVG path builders for the chart marks. */

export type Point = { x: number; y: number } | null;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A polyline through the points; `null` breaks the line into separate subpaths. */
export function linePath(points: readonly Point[]): string {
  let d = '';
  let drawing = false;
  for (const point of points) {
    if (!point) {
      drawing = false;
      continue;
    }
    d += `${drawing ? 'L' : 'M'}${r2(point.x)},${r2(point.y)}`;
    drawing = true;
  }
  return d;
}

/**
 * A bar from the baseline to the value: rounded at the data end, square at the
 * baseline. Works for negative values (the bar grows downward, rounded at the bottom).
 */
export function barPath(x: number, width: number, baseline: number, value: number, radius = 4): string {
  const height = Math.abs(baseline - value);
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const x1 = x + width;
  if (value <= baseline) {
    // Upward bar: top is the data end.
    return (
      `M${r2(x)},${r2(baseline)}V${r2(value + r)}` +
      `Q${r2(x)},${r2(value)} ${r2(x + r)},${r2(value)}` +
      `H${r2(x1 - r)}Q${r2(x1)},${r2(value)} ${r2(x1)},${r2(value + r)}` +
      `V${r2(baseline)}Z`
    );
  }
  return (
    `M${r2(x)},${r2(baseline)}V${r2(value - r)}` +
    `Q${r2(x)},${r2(value)} ${r2(x + r)},${r2(value)}` +
    `H${r2(x1 - r)}Q${r2(x1)},${r2(value)} ${r2(x1)},${r2(value - r)}` +
    `V${r2(baseline)}Z`
  );
}
