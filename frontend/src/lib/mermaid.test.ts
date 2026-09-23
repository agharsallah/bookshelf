import { describe, expect, it } from 'vitest';
import { toMermaid } from './mermaid';

describe('toMermaid', () => {
  it('declares a flowchart with quoted labels and labelled edges', () => {
    const source = toMermaid({
      type: 'diagram',
      direction: 'LR',
      nodes: [
        { id: 'a', label: 'Stock "S"' },
        { id: 'b', label: 'Flow <in>' },
      ],
      edges: [
        { from: 'b', to: 'a', label: 'fills' },
        { from: 'a', to: 'b' },
      ],
      cites: [],
    });
    expect(source).toBe(
      [
        'flowchart LR',
        '  a["Stock #quot;S#quot;"]',
        '  b["Flow #lt;in#gt;"]',
        '  b -->|"fills"| a',
        '  a --> b',
      ].join('\n'),
    );
  });

  it('defaults to top-down', () => {
    expect(toMermaid({ type: 'diagram', nodes: [{ id: 'x', label: 'X' }], edges: [], cites: [] })).toMatch(
      /^flowchart TD\n/,
    );
  });
});
