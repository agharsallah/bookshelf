import { describe, expect, it } from 'vitest';
import { collectCites, walkSpans, type RenderBlock } from './contract';

const blocks: RenderBlock[] = [
  { type: 'heading', level: 2, text: 'Loops' },
  { type: 'paragraph', spans: [{ text: 'A', cites: ['ch01/p001'] }, { text: 'B', cites: ['ch01/p002', 'ch01/p001'] }] },
  { type: 'bullets', items: [[{ text: 'C', cites: [] }], [{ text: 'D', cites: ['ch02/p001'] }]] },
  { type: 'table', header: ['h'], rows: [[{ text: 'E', cites: ['ch03/p001'] }]] },
  { type: 'quote', text: 'q', cites: ['ch04/p001'], page: 3 },
  { type: 'math', latex: 'x', meaning: [{ text: 'F', cites: ['ch05/p001'] }], cites: ['ch05/p002'] },
];

describe('walkSpans', () => {
  it('visits every span in reading order with its block index', () => {
    const seen: string[] = [];
    walkSpans(blocks, (span, index) => seen.push(`${index}:${span.text}`));
    expect(seen).toEqual(['1:A', '1:B', '2:C', '2:D', '3:E', '5:F']);
  });
});

describe('collectCites', () => {
  it('returns span and block-level anchors once each, in first-seen order', () => {
    expect(collectCites(blocks)).toEqual([
      'ch01/p001',
      'ch01/p002',
      'ch02/p001',
      'ch03/p001',
      'ch04/p001',
      'ch05/p001',
      'ch05/p002',
    ]);
  });

  it('is empty for blocks without cites', () => {
    expect(collectCites([{ type: 'heading', level: 3, text: 'x' }])).toEqual([]);
  });
});
