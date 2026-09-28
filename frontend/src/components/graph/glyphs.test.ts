import { describe, expect, it } from 'vitest';
import { glyphParts, glyphPath } from './glyphs';
import { CONCEPT_KIND_STYLES, conceptKindOf, MARKED_CONCEPT_KINDS } from './styles';

describe('paper concept kinds', () => {
  it('mark exactly the paper vocabulary, each with its own glyph and colour', () => {
    expect(MARKED_CONCEPT_KINDS).toEqual(['method', 'dataset', 'metric', 'task']);
    const glyphs = MARKED_CONCEPT_KINDS.map((k) => CONCEPT_KIND_STYLES[k].glyph);
    const colors = MARKED_CONCEPT_KINDS.map((k) => CONCEPT_KIND_STYLES[k].color);
    expect(new Set(glyphs).size).toBe(4);
    expect(new Set(colors).size).toBe(4);
    expect(colors).not.toContain(CONCEPT_KIND_STYLES.concept.color);
  });

  it('reads a kind from a wire value and ignores anything else', () => {
    expect(conceptKindOf('metric')).toBe('metric');
    expect(conceptKindOf('Okafor · Queueing')).toBeUndefined();
    expect(conceptKindOf(null)).toBeUndefined();
  });
});

describe('glyphParts', () => {
  it('draws nothing for the generic ring and stays inside the ring for the rest', () => {
    expect(glyphParts('none', 0, 0, 10)).toEqual([]);
    for (const g of ['dot', 'rows', 'tick', 'plus'] as const) {
      const parts = glyphParts(g, 0, 0, 10);
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        const xs = p.kind === 'dot' ? [p.x - p.r, p.x + p.r] : [p.x1, p.x2, p.y1, p.y2];
        for (const v of xs) expect(Math.abs(v)).toBeLessThan(10);
      }
    }
    expect(glyphPath('plus', 7, 7, 5)).toBe('M4.5 7L9.5 7M7 4.5L7 9.5');
  });
});
