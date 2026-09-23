import { describe, expect, it } from 'vitest';
import type { ChartBlock } from '../../../lib/contract';
import { layoutChart, seriesColor, SERIES_SLOTS } from './layout';

const bar: ChartBlock = {
  type: 'chart',
  kind: 'bar',
  x: { label: 'Point', values: ['A', 'B', 'C'] },
  series: [{ name: 'Effect', values: [2, null, 4] }],
  cites: [],
};

describe('layoutChart', () => {
  it('grows bars from a zero baseline and skips missing values', () => {
    const layout = layoutChart(bar, 640, 300);
    const bars = layout.series[0]!.bars;
    expect(bars.map((b) => b.index)).toEqual([0, 2]);
    expect(layout.baseline).toBe(layout.plot.bottom);
    expect(layout.yTicks.map((t) => t.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it('places numeric x values proportionally on line charts', () => {
    const layout = layoutChart(
      { ...bar, kind: 'line', x: { label: 'Year', values: [2000, 2001, 2010] }, series: [{ name: 's', values: [1, 2, 3] }] },
      640,
      300,
    );
    const [a, b, c] = layout.xPositions as [number, number, number];
    expect((b - a) / (c - a)).toBeCloseTo(0.1);
  });

  it('direct-labels up to four line series and keeps labels apart', () => {
    const layout = layoutChart(
      {
        ...bar,
        kind: 'line',
        series: [
          { name: 'a', values: [1, 2, 5] },
          { name: 'b', values: [1, 2, 5] },
        ],
      },
      640,
      300,
    );
    const [first, second] = layout.series.map((s) => s.endLabel!);
    expect(second!.y - first!.y).toBeGreaterThanOrEqual(14);
  });
});

describe('seriesColor', () => {
  it('uses the validated slots in order, then a neutral', () => {
    expect(seriesColor(0)).toBe('var(--series-1)');
    expect(seriesColor(SERIES_SLOTS)).toBe('var(--series-other)');
  });
});
