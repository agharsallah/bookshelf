import { describe, expect, it } from 'vitest';
import type { SourceBlock } from '../api';
import { suggestAnchors } from './CitePicker';

const block = (anchor: string, text: string): SourceBlock => ({ id: anchor, anchor, kind: 'paragraph', heading: null, text, page_from: null, page_to: null, meta: {} });
const blocks = [block('ch01/p001', 'Stocks accumulate.'), block('ch01/p002', 'Flows change stocks.'), block('ch02/p001', 'Loops close on stocks.')];

describe('suggestAnchors', () => {
  it('matches anchors by prefix before text matches', () => {
    expect(suggestAnchors(blocks, 'ch02').map((b) => b.anchor)).toEqual(['ch02/p001']);
    expect(suggestAnchors(blocks, 'stocks').map((b) => b.anchor)).toEqual(['ch01/p001', 'ch01/p002', 'ch02/p001']);
  });

  it('leaves out anchors the span already cites, and suggests nothing for an empty query', () => {
    expect(suggestAnchors(blocks, 'ch01', ['ch01/p001']).map((b) => b.anchor)).toEqual(['ch01/p002']);
    expect(suggestAnchors(blocks, '  ')).toEqual([]);
  });
});
