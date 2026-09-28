import { describe, expect, it } from 'vitest';
import { buildPalette } from './palette';

describe('buildPalette', () => {
  it('resolves every canvas colour from the design tokens', () => {
    const palette = buildPalette((token) => `resolved(${token})`);
    expect(palette.paper).toBe('resolved(--paper)');
    expect(palette.grid).toBe('resolved(--chart-axis)');
    expect(palette.marker).toBe('resolved(--marker)');
    expect(palette.markerInk).toBe('resolved(--marker-ink)');
    expect(palette.kinds.concept).toBe('resolved(--series-1)');
    expect(palette.conceptKinds.framework).toBe('resolved(--series-1)');
    expect(palette.conceptKinds.dataset).toBe('resolved(--series-5)');
    expect(palette.relations.contradicts).toBe('resolved(--tone-important)');
  });
});
