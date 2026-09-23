/**
 * Turns a chart block into drawable geometry. Pure, so the scale and path logic is
 * tested without a DOM; `ChartBlock` only maps this onto SVG elements.
 */
import type { ChartBlock } from '../../../lib/contract';
import { barPath, linePath, type Point } from './paths';
import { bandScale, linearScale, niceDomain, pointScale, valueExtent } from './scales';

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 300;
export const MIN_CHART_WIDTH = 320;

/** Validated categorical slots (tokens.css); series past these fold to a neutral. */
export const SERIES_SLOTS = 6;

export function seriesColor(index: number): string {
  return index < SERIES_SLOTS ? `var(--series-${index + 1})` : 'var(--series-other)';
}

export interface Plot {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Tick {
  value: number;
  y: number;
  label: string;
}

export interface XLabel {
  x: number;
  label: string;
}

export interface SeriesGeometry {
  name: string;
  color: string;
  /** Bars: one path per non-null value. */
  bars: { index: number; d: string }[];
  /** Line: the polyline. */
  line: string;
  /** Scatter dots / line end-markers, aligned with x values (`null` = no value). */
  points: Point[];
  /** Direct label at the last value (lines with ≤ 4 series). */
  endLabel: { x: number; y: number } | null;
}

export interface ChartLayout {
  plot: Plot;
  yTicks: Tick[];
  xLabels: XLabel[];
  /** Hover/crosshair x position for each x value. */
  xPositions: number[];
  baseline: number;
  series: SeriesGeometry[];
}

const numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function formatValue(value: number | null): string {
  if (value === null) return '—';
  return Math.abs(value) >= 10_000 ? compactFormat.format(value) : numberFormat.format(value);
}

function isNumericX(values: readonly (string | number)[]): values is number[] {
  return values.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Show at most one x label per ~64px so they never collide. */
function thinLabels(labels: XLabel[], plotWidth: number): XLabel[] {
  const max = Math.max(2, Math.floor(plotWidth / 64));
  if (labels.length <= max) return labels;
  const every = Math.ceil(labels.length / max);
  return labels.filter((_, i) => i % every === 0);
}

export function layoutChart(block: ChartBlock, width = CHART_WIDTH, height = CHART_HEIGHT): ChartLayout {
  const directLabels = block.kind === 'line' && block.series.length > 1 && block.series.length <= 4;
  const plot: Plot = { left: 52, top: 14, right: width - (directLabels ? 110 : 18), bottom: height - 46 };
  const count = block.x.values.length;

  const [min, max] = valueExtent(block.series, block.kind === 'bar');
  const { domain, ticks } = niceDomain(min, max, 5);
  const y = linearScale(domain, [plot.bottom, plot.top]);
  const yTicks = ticks.map((value) => ({ value, y: y(value), label: formatValue(value) }));
  const baseline = y(Math.max(domain[0], Math.min(0, domain[1])));

  let xPositions: number[];
  let barGeometry: ((values: readonly (number | null)[], seriesIndex: number) => SeriesGeometry['bars']) | null = null;

  if (block.kind === 'bar') {
    const band = bandScale(count, [plot.left, plot.right]);
    const groups = block.series.length;
    const gap = 2;
    const barWidth = Math.min(24, (band.bandwidth - gap * (groups - 1)) / groups);
    const groupWidth = barWidth * groups + gap * (groups - 1);
    xPositions = block.x.values.map((_, i) => band.center(i));
    barGeometry = (values, s) =>
      values.flatMap((v, i) => {
        if (v === null) return [];
        const x = band.center(i) - groupWidth / 2 + s * (barWidth + gap);
        return [{ index: i, d: barPath(x, barWidth, baseline, y(v)) }];
      });
  } else if (isNumericX(block.x.values)) {
    const xs = block.x.values;
    const { domain: xDomain } = niceDomain(Math.min(...xs), Math.max(...xs), 6);
    const tight: [number, number] = [Math.min(...xs), Math.max(...xs)];
    const x = linearScale(block.kind === 'scatter' ? xDomain : tight, [plot.left + 8, plot.right - 8]);
    xPositions = xs.map(x);
  } else {
    const x = pointScale(count, [plot.left, plot.right]);
    xPositions = block.x.values.map((_, i) => x(i));
  }

  const xLabels = thinLabels(
    block.x.values.map((v, i) => ({ x: xPositions[i] ?? 0, label: typeof v === 'number' ? String(v) : v })),
    plot.right - plot.left,
  );

  const series = block.series.map((s, index): SeriesGeometry => {
    const points: Point[] = s.values.map((v, i) => (v === null ? null : { x: xPositions[i] ?? 0, y: y(v) }));
    const lastIndex = s.values.findLastIndex((v) => v !== null);
    const last = lastIndex >= 0 ? points[lastIndex] : null;
    return {
      name: s.name,
      color: seriesColor(index),
      bars: barGeometry ? barGeometry(s.values, index) : [],
      line: block.kind === 'line' ? linePath(points) : '',
      points,
      endLabel: directLabels && last ? { x: last.x + 10, y: last.y } : null,
    };
  });

  spreadEndLabels(series, 14);
  return { plot, yTicks, xLabels, xPositions, baseline, series };
}

/** Push direct labels apart vertically so neighbours never overlap (min `gap` px). */
export function spreadEndLabels(series: SeriesGeometry[], gap: number): void {
  const labels = series.flatMap((s) => (s.endLabel ? [s.endLabel] : [])).sort((a, b) => a.y - b.y);
  let previous = -Infinity;
  for (const label of labels) {
    if (label.y - previous < gap) label.y = previous + gap;
    previous = label.y;
  }
}

/** One-sentence summary for the chart's accessible name. */
export function describeChart(block: ChartBlock): string {
  const names = block.series.map((s) => s.name).join(', ');
  const title = block.title ? `${block.title}. ` : '';
  return `${title}${block.kind} chart of ${names} by ${block.x.label}, ${block.x.values.length} points.`;
}
