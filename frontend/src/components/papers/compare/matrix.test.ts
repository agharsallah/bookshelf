import { describe, expect, it } from 'vitest';
import type { ResultCell, ResultsComparison } from '../../../lib/api/types/paperShelf';
import { buildMatrix, citeLink, compareHref, metricCharts, paperKeys, parseIds, setName } from './matrix';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

function cell(column: string, paper: string, value: number, extra: Partial<ResultCell> = {}): ResultCell {
  return { column, paper_id: paper, value, unit: '%', setting: null, is_proposed: false, comparable: true, best: false, cites: [], ...extra };
}

const comparison: ResultsComparison = {
  papers: [
    { id: A, slug: 'transformer', title: 'Attention', year: 2017, results_artifact_id: 'r1', rows: 2 },
    { id: B, slug: 'bert', title: 'BERT', year: 2018, results_artifact_id: null, rows: 0 },
  ],
  columns: [
    { key: 'wmt|bleu', dataset: 'WMT', metric: 'BLEU', unit: '%', higher_is_better: true, best: 28.4, cells: 2 },
    { key: 'glue|score', dataset: 'GLUE', metric: 'Score', unit: '%', higher_is_better: true, best: null, cells: 1 },
    { key: 'wmt|ppl', dataset: 'WMT', metric: 'Perplexity', unit: null, higher_is_better: false, best: 4.3, cells: 2 },
  ],
  rows: [
    {
      key: 'transformer',
      method: 'Transformer',
      cells: [
        cell('wmt|bleu', A, 28.4, { is_proposed: true, best: true, cites: [`${A}#ch06/t002`] }),
        cell('wmt|ppl', A, 4.33, { unit: null, best: true }),
        cell('glue|score', A, 70, { unit: 'pts', comparable: false }),
      ],
    },
    { key: 'convs2s', method: 'ConvS2S', cells: [cell('wmt|bleu', A, 25.16), cell('wmt|ppl', A, 5.1, { unit: null })] },
  ],
};

describe('buildMatrix', () => {
  const view = buildMatrix(comparison);

  it('groups columns by dataset in first-seen order', () => {
    expect(view.columns.map((c) => c.key)).toEqual(['wmt|bleu', 'wmt|ppl', 'glue|score']);
    expect(view.groups).toEqual([
      { dataset: 'WMT', span: 2 },
      { dataset: 'GLUE', span: 1 },
    ]);
  });

  it('aligns every row’s cells with the columns and marks best, proposed and incomparable', () => {
    const [transformer, convs2s] = view.rows;
    expect(transformer?.proposed).toBe(true);
    expect(convs2s?.proposed).toBe(false);
    expect(transformer?.cells[0]?.[0]).toMatchObject({ text: '28.4', best: true, proposed: true });
    expect(transformer?.cells[2]?.[0]).toMatchObject({ comparable: false, unit: 'pts' });
    expect(convs2s?.cells[2]).toEqual([]);
  });

  it('turns cites into links into the right paper’s reader', () => {
    expect(view.rows[0]?.cells[0]?.[0]?.cites[0]).toEqual({ href: '/documents/transformer/read/ch06/t002', label: '6.2', title: 'Attention, ch06/t002' });
  });
});

describe('paperKeys', () => {
  it('gives each paper a fixed slot in pick order and says which have results', () => {
    const keys = paperKeys(comparison);
    expect(keys.map((k) => k.color)).toEqual(['var(--series-1)', 'var(--series-2)']);
    expect(keys.map((k) => k.hasResults)).toEqual([true, false]);
  });
});

describe('citeLink', () => {
  it('keeps a cite into an unknown paper as plain text', () => {
    expect(citeLink('zzz#ch01/p001', new Map()).href).toBeNull();
  });
});

describe('metricCharts', () => {
  const charts = metricCharts(comparison);

  it('draws one chart per column with comparable values, best first in the column’s direction', () => {
    expect(charts.map((c) => c.key)).toEqual(['wmt|bleu', 'wmt|ppl']);
    expect(charts[0]?.rows.map((r) => r.label)).toEqual(['Transformer', 'ConvS2S']);
    expect(charts[1]?.rows.map((r) => r.label)).toEqual(['Transformer', 'ConvS2S']);
    expect(charts[1]?.higherIsBetter).toBe(false);
  });

  it('colours bars by paper and labels value and unit', () => {
    expect(charts[0]?.series).toEqual([{ key: A, label: 'Attention', color: 'var(--series-1)' }]);
    expect(charts[0]?.rows[0]).toMatchObject({ values: { [A]: 28.4 }, valueLabel: '28.4 %', sub: 'Attention, proposed, best' });
  });

  it('leaves out a column whose only value is in another unit', () => {
    expect(charts.find((c) => c.key === 'glue|score')).toBeUndefined();
  });
});

describe('ids in the URL', () => {
  it('reads comma-separated and repeated ids, once each, at most 20', () => {
    expect(parseIds(new URLSearchParams('ids=a,b&ids=c&ids=a'))).toEqual(['a', 'b', 'c']);
    expect(parseIds(new URLSearchParams(`ids=${Array.from({ length: 25 }, (_, i) => `p${i}`).join(',')}`))).toHaveLength(20);
    expect(compareHref(['a', 'b'])).toBe('/papers/compare?ids=a,b');
  });

  it('names a set after its papers', () => {
    expect(setName(['Atlas: few-shot learning', 'Leveraging Passage Retrieval with Generative Models for QA'])).toBe(
      'Atlas and Leveraging Passage Retrieval with Generative…',
    );
    expect(setName(['A', 'B', 'C', 'D'])).toBe('A, B and 2 more');
  });
});
