import { describe, expect, it } from 'vitest';
import type { NodeKind, NodeMeta } from '../../lib/api/types/documents';
import { figureItems, figureShelf } from './figures';

const node = (anchor: string, kind: NodeKind, meta: NodeMeta = {}, text: string | null = null, page_from: number | null = 3) => ({ anchor, kind, meta, text, page_from });

describe('figureItems', () => {
  it('lists figures and formulas that have an image, in reading order', () => {
    const items = figureItems([
      node('ch01/f001', 'figure', { image_path: 'doc/ch01/f001.png', caption: 'Figure 1.1 The loop' }),
      node('ch01/p001', 'paragraph', {}, 'Text'),
      node('ch01/f002', 'figure', {}),
      node('ch01/m001', 'math', { image_path: 'doc/ch01/m001.png' }, 'E = mc^2', null),
    ]);
    expect(items).toEqual([
      { id: 'ch01/f001', kind: 'image', src: '/api/media/doc/ch01/f001.png', title: 'Figure 1.1 The loop', alt: 'Figure 1.1 The loop', meta: 'Page 3', anchor: 'ch01/f001' },
      { id: 'ch01/m001', kind: 'image', src: '/api/media/doc/ch01/m001.png', title: 'Formula 1', alt: 'E = mc^2', meta: undefined, anchor: 'ch01/m001' },
    ]);
  });

  it('falls back to the figure text, then a numbered name', () => {
    const [described, bare] = figureItems([
      node('a', 'figure', { image_path: 'a.png' }, 'Two chairs at a table'),
      node('b', 'figure', { image_path: 'b.png', caption: '  ' }),
    ]);
    expect([described?.title, bare?.title]).toEqual(['Two chairs at a table', 'Figure 2']);
  });
});

describe('figureShelf', () => {
  const explained = (anchor: string) => ({ anchor, id: `x-${anchor}` });

  it('pairs each original figure with its explanation, in reading order', () => {
    const shelf = figureShelf(
      [
        node('ch01/f001', 'figure', { image_path: 'f1.png', caption: ' Figure 1.1 The loop ' }, null, 4),
        node('ch01/t001', 'table', {}),
        node('ch01/p001', 'paragraph', {}, 'Text'),
        node('ch01/f002', 'figure', { image_path: 'f2.png' }, 'A loop drawn by hand', null),
        node('ch01/f003', 'figure', {}),
      ],
      [explained('ch01/f002'), explained('ch01/t001')],
    );
    expect(shelf).toEqual([
      { anchor: 'ch01/f001', explanation: null, original: { src: '/api/media/f1.png', alt: 'Figure 1.1 The loop', caption: 'Figure 1.1 The loop', page: 4, n: 1, of: 2 } },
      { anchor: 'ch01/t001', explanation: explained('ch01/t001'), original: null },
      { anchor: 'ch01/f002', explanation: explained('ch01/f002'), original: { src: '/api/media/f2.png', alt: 'A loop drawn by hand', caption: null, page: null, n: 2, of: 2 } },
    ]);
  });

  it('keeps explanations of blocks the chapter did not load, at the end', () => {
    const shelf = figureShelf([node('ch01/f001', 'figure', { image_path: 'f1.png' })], [explained('ch01/f900'), explained('ch01/f001')]);
    expect(shelf.map((item) => [item.anchor, item.original !== null, item.explanation !== null])).toEqual([
      ['ch01/f001', true, true],
      ['ch01/f900', false, true],
    ]);
  });
});
