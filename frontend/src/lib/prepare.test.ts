import { describe, expect, it } from 'vitest';
import { resolveLanguage } from './highlight';
import { prepareBlocks } from './prepare';

describe('resolveLanguage', () => {
  it.each([
    ['py', 'python'],
    ['Python', 'python'],
    ['sh', 'bash'],
    ['brainfuck', null],
    [undefined, null],
  ])('maps %s to %s', (input, expected) => {
    expect(resolveLanguage(input)).toBe(expected);
  });
});

describe('prepareBlocks', () => {
  it('pre-renders code with Shiki and math with KaTeX, leaving other blocks untouched', async () => {
    const heading = { type: 'heading', level: 2, text: 'x' } as const;
    const [code, math, unknownLang, same] = await prepareBlocks([
      { type: 'code', language: 'py', text: 'def f():\n    return 1', cites: [] },
      { type: 'math', latex: 'a^2', cites: [] },
      { type: 'code', language: 'cobol', text: 'DISPLAY 1', cites: [] },
      heading,
    ]);
    expect(code).toMatchObject({ type: 'code', html: expect.stringContaining('class="shiki') });
    expect(code && 'html' in code ? code.html : '').toContain('--shiki-token-keyword');
    expect(math).toMatchObject({ type: 'math', html: expect.stringContaining('class="katex') });
    expect(unknownLang).not.toHaveProperty('html');
    expect(same).toBe(heading);
  });
});
