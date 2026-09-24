// @vitest-environment happy-dom
/**
 * Parses `toMermaid` output with the real Mermaid parser: the render contract allows
 * any `^[A-Za-z][A-Za-z0-9_]*$` node id, including Mermaid keywords.
 */
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import type { DiagramBlock } from './contract';
import { toMermaid } from './mermaid';

function diagram(ids: string[]): DiagramBlock {
  return {
    type: 'diagram',
    nodes: ids.map((id) => ({ id, label: id.toUpperCase() })),
    edges: ids.slice(1).map((id) => ({ from: ids[0] ?? '', to: id, label: 'then' })),
    cites: [],
  };
}

describe('toMermaid output parses', () => {
  it('for ordinary ids', async () => {
    await expect(mermaid.parse(toMermaid(diagram(['stock', 'flow'])))).resolves.toBeTruthy();
  });

  it.each(['end', 'graph', 'subgraph', 'style', 'click', 'classDef'])(
    'when a node id is the Mermaid keyword %j',
    async (keyword) => {
      await expect(mermaid.parse(toMermaid(diagram(['start', keyword])))).resolves.toBeTruthy();
    },
  );
});
