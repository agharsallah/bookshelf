import { describe, expect, it } from 'vitest';
import type { NodeKind, NodeMeta } from '../../lib/api/types/documents';
import { figureItems } from './figures';

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
