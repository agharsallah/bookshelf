import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPRODUCIBILITY_STATUSES } from '../../lib/api/types/papers';
import { filterSymbols, looseLatex, prepareSymbols } from './notation';
import { checklistRows, checklistSummary, rubricRows, socraticCommand, statusMark } from './review';
import { parseAssessment, parseNotation } from './study-bodies';

const example = (skill: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../../skills/${skill}/example.json`, import.meta.url), 'utf8'));

describe('the reproducibility checklist', () => {
  it('gives every status its own icon and word, so colour is never the only cue', () => {
    const marks = REPRODUCIBILITY_STATUSES.map(statusMark);
    expect(marks.map((m) => [m.icon, m.label, m.tone])).toEqual([
      ['✓', 'Reported', 'good'],
      ['◐', 'Partly', 'warning'],
      ['✕', 'Missing', 'critical'],
      ['?', 'Not said', 'neutral'],
    ]);
    expect(new Set(marks.map((m) => m.icon)).size).toBe(marks.length);
  });

  it('names each item and sums the example up', () => {
    const { reproducibility } = parseAssessment(example('assess-paper'));
    expect(checklistRows(reproducibility)[4]).toMatchObject({ item: 'compute', name: 'Compute budget', mark: { label: 'Missing' } });
    expect(checklistSummary(reproducibility)).toBe('5 of 10 reported, 2 partly, 2 missing, 1 not said');
  });
});

describe('rubricRows', () => {
  it('draws one bar per scored criterion, in rubric order', () => {
    const rows = rubricRows(parseAssessment(example('assess-paper')));
    expect(rows.map((r) => [r.label, r.values.score, r.valueLabel])).toEqual([
      ['Novelty', 3, '3 of 5'],
      ['Rigour', 3, '3 of 5'],
      ['Evidence', 4, '4 of 5'],
      ['Clarity', 4, '4 of 5'],
      ['Reproducibility', 3, '3 of 5'],
      ['Relevance to your shelf', 4, '4 of 5'],
    ]);
  });
});

it('gives the Socratic reviewer’s command for the paper', () => {
  expect(socraticCommand('gated-retrieval-adapters')).toBe('/review-paper gated-retrieval-adapters socratic');
});

describe('the notation filter', () => {
  const symbols = parseNotation(example('make-notation'));

  it('finds a symbol by its meaning or by its LaTeX written loosely', () => {
    expect(filterSymbols(symbols, 'gate').map((s) => s.latex)).toEqual(['w', 'g_i']);
    expect(filterSymbols(symbols, 'sigma').map((s) => s.latex)).toEqual(['\\sigma']);
    expect(filterSymbols(symbols, 'g_i').map((s) => s.latex)).toEqual(['g_i']);
    expect(filterSymbols(symbols, '  ')).toHaveLength(symbols.length);
    expect(filterSymbols(symbols, 'zebra')).toEqual([]);
  });

  it('writes LaTeX as someone would type it', () => {
    expect(looseLatex('\\mathbf{W}_{q}^{T}')).toBe('wqt');
  });

  it('attaches rendered HTML, leaving a symbol that fails to render as source', async () => {
    const out = await prepareSymbols(symbols.slice(0, 2), (latex) => (latex === 'q' ? Promise.resolve('<b>q</b>') : Promise.reject(new Error('bad'))));
    expect(out.map((s) => s.html)).toEqual(['<b>q</b>', undefined]);
  });
});
