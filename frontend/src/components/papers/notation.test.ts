import { describe, expect, it } from 'vitest';
import type { NodeKind, TreeNode } from '../../lib/api/types/documents';
import { placeSymbols, sectionHeading } from './notation';

const node = (anchor: string, kind: NodeKind, heading: string | null, children: TreeNode[] = []): TreeNode => ({
  id: anchor, anchor, kind, ordinal: 0, depth: anchor.split('/').length - 1, heading, text: null, page_from: null, page_to: null, meta: {}, children,
});

// Anchors count sections by position (ch04 is the paper's section 3: an abstract comes first).
const outline = [
  node('ch01', 'chapter', 'Abstract'),
  node('ch04', 'chapter', '3 Model Architecture', [
    node('ch04/s02', 'section', '3.2 Attention', [node('ch04/s02/s01', 'section', '3.2.1 Scaled Dot-Product Attention'), node('ch04/s02/s02', 'section', '  ')]),
  ]),
  node('ch10', 'chapter', 'Conclusion'),
];

describe('sectionHeading', () => {
  it('names the innermost section by the paper’s own heading, not the anchor numbering', () => {
    expect(sectionHeading(outline, 'ch04/s02/s01/m003')).toBe('3.2.1 Scaled Dot-Product Attention');
    expect(sectionHeading(outline, 'ch04/s02/p001')).toBe('3.2 Attention');
    expect(sectionHeading(outline, 'ch04/p002')).toBe('3 Model Architecture');
  });

  it('falls back to the enclosing heading when a section has none, and to null outside the outline', () => {
    expect(sectionHeading(outline, 'ch04/s02/s02/p001')).toBe('3.2 Attention');
    expect(sectionHeading(outline, 'ch1/p001')).toBeNull();
    expect(sectionHeading(outline, 'ch99/p001')).toBeNull();
  });
});

describe('placeSymbols', () => {
  it('adds the section of first use and leaves symbols it cannot place alone', () => {
    const placed = placeSymbols(
      [
        { latex: 'd_k', meaning: 'Key dimension.', firstAnchor: 'ch04/s02/s01/m001', cites: [] },
        { latex: 'x', meaning: 'Input.', firstAnchor: 'zz/p001', cites: [] },
        { latex: 'y', meaning: 'Output.', firstAnchor: null, cites: [] },
      ],
      outline,
    );
    expect(placed.map((s) => s.firstPlace)).toEqual(['3.2.1 Scaled Dot-Product Attention', undefined, undefined]);
  });
});
