import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectCites, type RenderBlock } from '../../lib/contract';
import { adaptBody } from '../review/body/adapters';
import {
  formulaAnchorOf,
  formulaId,
  mathHref,
  minutesLabel,
  parseMathExplainer,
  pathItems,
  renderSymbols,
  totalMinutes,
} from './math-explainer';

/** explain-math's own example (the shape the backend validates). */
const example: unknown = JSON.parse(readFileSync(new URL('../../../../skills/explain-math/example.json', import.meta.url), 'utf8'));
const headings = (blocks: RenderBlock[]) => blocks.flatMap((b) => (b.type === 'heading' ? [b.text] : []));

describe('parseMathExplainer', () => {
  it('reads the example formula by formula, in learning order', () => {
    const m = parseMathExplainer(example);
    expect(m.formulas.map((f) => [f.anchor, f.name])).toEqual([
      ['ch03/s01/m001', 'The trust score'],
      ['ch03/s01/m002', 'Listening in proportion to trust'],
    ]);
    const [trust] = m.formulas;
    expect(trust?.symbols.map((s) => s.latex)).toEqual(['g_i', 'q', 'p_i', 'w', '\\sigma']);
    expect(trust?.example.steps?.items).toHaveLength(3);
    expect(trust?.example.extra?.type).toBe('table');
    expect(trust?.confusion?.tone).toBe('caution');
    expect(trust?.tryIt.answer[0]?.text).toContain('= 0.5');
    expect(m.formulas[1]?.explore.prerequisites).toContainEqual({ concept: 'Attention', shelfConcept: 'attention' });
    expect(m.map?.nodes).toHaveLength(4);
    expect(m.glossary.map((g) => g.term)).toEqual(['Vector', 'Sigmoid']);
    expect(m.loveNote?.tone).toBe('insight');
  });

  it('renders less, never throws, on a malformed body', () => {
    const m = parseMathExplainer({ formulas: [{ latex: 'x', symbols: [{ symbol: '' }], worked_example: { steps: 'no' } }, 'junk'], path: [{ title: 'Go', minutes: 'ten' }] });
    expect(m.formulas).toHaveLength(1);
    expect(m.formulas[0]).toMatchObject({ name: 'A formula', symbols: [], diagram: null, confusion: null });
    expect(m.formulas[0]?.example.steps).toBeNull();
    expect(m.path).toEqual([{ title: 'Go', formula: null, minutes: 0, goal: [] }]);
    expect(parseMathExplainer(null).formulas).toEqual([]);
  });

  it('attaches inline KaTeX to each symbol, keeping the source when rendering fails', async () => {
    const m = await renderSymbols(parseMathExplainer(example), (latex) => (latex === 'q' ? Promise.reject(new Error('bad')) : Promise.resolve(`<b>${latex}</b>`)));
    expect(m.formulas[0]?.symbols.map((s) => s.html)).toEqual(['<b>g_i</b>', undefined, '<b>p_i</b>', '<b>w</b>', '<b>\\sigma</b>']);
  });
});

describe('the learning path', () => {
  it('numbers the formula each step studies and adds up the minutes', () => {
    const m = parseMathExplainer(example);
    expect(pathItems(m).map((p) => [p.title, p.formulaNumber, p.minutes])).toEqual([
      ['Warm up: numbers as lists', null, 5],
      ['The trust score', 1, 15],
      ['Listening in proportion to trust', 2, 10],
    ]);
    expect(totalMinutes(m.path)).toBe(30);
    expect(minutesLabel(30)).toBe('30 min');
    expect(minutesLabel(65)).toBe('1 h 5 min');
    expect(minutesLabel(120)).toBe('2 h');
  });
});

describe('links into the math tab', () => {
  it('scrolls to a formula card by its anchor', () => {
    expect(formulaId('ch03/s01/m001')).toBe('formula-ch03-s01-m001');
    expect(mathHref('bert')).toBe('/documents/bert/paper/math');
    expect(mathHref('bert', 'ch03/s01/m001')).toBe('/documents/bert/paper/math#formula-ch03-s01-m001');
  });

  it('finds the formula a notation symbol is used in: its first use, else a cited formula', () => {
    expect(formulaAnchorOf({ firstAnchor: 'ch03/s01/m001', cites: [] })).toBe('ch03/s01/m001');
    expect(formulaAnchorOf({ firstAnchor: 'ch03/s01/p001', cites: ['ch03/s01/p001', 'ch03/s01/m002'] })).toBe('ch03/s01/m002');
    expect(formulaAnchorOf({ firstAnchor: 'ch03/p001', cites: ['ch03/p002'] })).toBeNull();
    expect(formulaAnchorOf({ firstAnchor: null, cites: ['ch03/m1x'] })).toBeNull();
  });
});

describe('the math explainer in the review queue', () => {
  it('draws the example with every cite and a heading per formula', () => {
    const { blocks } = adaptBody('math_explainer', example);
    expect(headings(blocks)).toEqual(['The big picture', '1. The trust score', '2. Listening in proportion to trust', 'Learning path (30 min)', 'Glossary']);
    expect(blocks.filter((b) => b.type === 'diagram')).toHaveLength(3);
    expect(blocks.at(-1)).toMatchObject({ type: 'callout', tone: 'insight' });
    const drawn = new Set(collectCites(blocks));
    for (const cite of ['ch01/p002', 'ch03/s01/m001', 'ch03/s01/m002', 'ch03/s01/p003', 'ch04/s02/p001']) expect(drawn).toContain(cite);
  });
});
