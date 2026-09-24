/**
 * Shiki's output colours tokens through CSS variables. Highlighted code appears both in
 * render blocks (CodeBlock) and in the reader's source blocks, so every variable it
 * uses must be defined globally, not only inside one component's scope.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { highlightCode } from './highlight';

const tokensCss = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const defined = new Set([...tokensCss.matchAll(/(--shiki-[\w-]+)\s*:/g)].map((m) => m[1]));

describe('highlightCode', () => {
  it('uses only colour variables the global tokens define', async () => {
    const html = await highlightCode('def f(x):\n    # a comment\n    return "s" + str(1)\n', 'py');
    const used = [...new Set([...(html ?? '').matchAll(/var\((--shiki-[\w-]+)\)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(3);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });

  it('returns null for a language it has no grammar for', async () => {
    expect(await highlightCode('x', 'brainfuck')).toBeNull();
  });
});
