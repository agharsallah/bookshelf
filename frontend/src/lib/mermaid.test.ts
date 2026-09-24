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
        '  n_a["Stock #quot;S#quot;"]',
        '  n_b["Flow #lt;in#gt;"]',
        '  n_b -->|"fills"| n_a',
        '  n_a --> n_b',
      ].join('\n'),
    );
  });

  it('defaults to top-down', () => {
    expect(toMermaid({ type: 'diagram', nodes: [{ id: 'x', label: 'X' }], edges: [], cites: [] })).toMatch(
      /^flowchart TD\n/,
    );
  });
});
