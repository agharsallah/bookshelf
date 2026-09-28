import { describe, expect, it } from 'vitest';
import type { ResultRow } from './extract-bodies';
import { chartColumns, columnBars, compareHref, datasetGroups, formatValue, isBest, matrixParts, resultColumns, resultMatrix } from './results';

const row = (over: Partial<ResultRow>): ResultRow => ({
  method: 'FiD-base',
  dataset: 'NQ',
  metric: 'EM',
  value: 48.2,
  unit: null,
  higherIsBetter: true,
  isProposed: false,
  setting: null,
  cites: ['ch04/s02/t001'],
  ...over,
});

describe('resultColumns', () => {
  it('marks the best of each column in its direction', () => {
    const [em, latency] = resultColumns([
      row({ value: 48.2 }),
      row({ method: 'GRA', value: 50.3, isProposed: true }),
      row({ metric: 'latency', value: 120, unit: 'ms', higherIsBetter: false }),
      row({ method: 'GRA', metric: 'latency', value: 95, unit: 'ms', higherIsBetter: false }),
    ]);
    expect([em?.best, em?.higherIsBetter]).toEqual([50.3, true]);
    expect([latency?.best, latency?.unit, latency?.higherIsBetter]).toEqual([95, 'ms', false]);
  });

  it('marks no best with a single comparable value, and compares only the column’s unit', () => {
    const [column] = resultColumns([row({ value: 3, unit: 's' }), row({ method: 'B', value: 1, unit: 's' }), row({ method: 'C', value: 0.1, unit: 'min' })]);
    expect(column?.unit).toBe('s');
    expect(column?.best).toBe(3);
    expect(column && isBest(column, row({ value: 3, unit: 'min' }))).toBe(false);
    expect(resultColumns([row({})])[0]?.best).toBeNull();
  });

  it('takes the majority direction when rows disagree', () => {
    const [column] = resultColumns([row({ higherIsBetter: false }), row({ method: 'B', higherIsBetter: false }), row({ method: 'C' })]);
    expect(column?.higherIsBetter).toBe(false);
  });
});

describe('resultMatrix', () => {
  it('puts the paper’s own methods first, one row per method and setting', () => {
    const matrix = resultMatrix([
      row({ method: 'FiD-base' }),
      row({ method: 'GRA', isProposed: true }),
      row({ method: 'GRA', isProposed: true, dataset: 'HotpotQA' }),
      row({ method: 'GRA', isProposed: true, setting: 'no gate' }),
    ]);
    expect(matrix.rows.map((r) => [r.method, r.setting, Object.keys(r.cells)])).toEqual([
      ['GRA', null, ['NQ|EM', 'HotpotQA|EM']],
      ['GRA', 'no gate', ['NQ|EM']],
      ['FiD-base', null, ['NQ|EM']],
    ]);
    expect(datasetGroups(matrix.columns).map((g) => [g.dataset, g.columns.length])).toEqual([
      ['NQ', 1],
      ['HotpotQA', 1],
    ]);
  });
});

describe('matrixParts', () => {
  it('splits systems reported on disjoint benchmarks into their own tables', () => {
    const matrix = resultMatrix([
      row({ method: 'BERT', dataset: 'GLUE', isProposed: true }),
      row({ method: 'BERT', dataset: 'GLUE', setting: 'no NSP', isProposed: true }),
      row({ method: 'GPT', dataset: 'GLUE' }),
      row({ method: 'BERT (Single)', dataset: 'SQuAD', isProposed: true }),
      row({ method: 'QANet', dataset: 'SQuAD' }),
    ]);
    const parts = matrixParts(matrix);
    expect(parts.map((p) => [p.columns.map((c) => c.key), p.rows.map((r) => r.key)])).toEqual([
      [['GLUE|EM'], ['BERT|', 'BERT|no NSP', 'GPT|']],
      [['SQuAD|EM'], ['BERT (Single)|', 'QANet|']],
    ]);
  });

  it('shows a system reported on two benchmarks in both tables, a family\'s datasets together', () => {
    const matrix = resultMatrix([
      row({ dataset: 'GLUE MNLI-m' }),
      row({ dataset: 'SWAG Dev' }),
      row({ method: 'GRA', dataset: 'GLUE QQP' }),
    ]);
    expect(matrixParts(matrix).map((p) => [p.columns.map((c) => c.dataset), p.rows.map((r) => r.method)])).toEqual([
      [['GLUE MNLI-m', 'GLUE QQP'], ['FiD-base', 'GRA']],
      [['SWAG Dev'], ['FiD-base']],
    ]);
  });
});

describe('the charts', () => {
  it('draws a column only with two comparable values, best first, the paper’s method in its own series', () => {
    const columns = resultColumns([
      row({ value: 48.2 }),
      row({ method: 'GRA', value: 50.3, isProposed: true }),
      row({ dataset: 'TriviaQA', value: 70 }),
    ]);
    const charts = chartColumns(columns);
    expect(charts.map((c) => c.key)).toEqual(['NQ|EM']);
    const bars = columnBars(charts[0]!);
    expect(bars.map((b) => [b.label, b.values, b.valueLabel])).toEqual([
      ['GRA', { proposed: 50.3 }, '50.3 best'],
      ['FiD-base', { other: 48.2 }, '48.2'],
    ]);
  });

  it('orders lower-is-better bars smallest first', () => {
    const [column] = resultColumns([row({ value: 9, higherIsBetter: false }), row({ method: 'B', value: 4, higherIsBetter: false })]);
    expect(columnBars(column!).map((b) => b.label)).toEqual(['B', 'FiD-base']);
  });
});

describe('formatValue', () => {
  it('keeps four significant digits and writes large and tiny numbers as powers of ten', () => {
    expect(formatValue(28.4, null)).toBe('28.4');
    expect(formatValue(4.9234, '%')).toBe('4.923 %');
    expect(formatValue(2.3e19, 'FLOPs')).toBe('2.3 × 10¹⁹ FLOPs');
    expect(formatValue(0.00012, null)).toBe('1.2 × 10⁻⁴');
    expect(formatValue(0, null)).toBe('0');
  });
});

it('links to the comparison of this paper with the ones picked', () => {
  expect(compareHref(['gated-retrieval-adapters', 'fusion-in-decoder'])).toBe('/papers/compare?ids=gated-retrieval-adapters,fusion-in-decoder');
});
