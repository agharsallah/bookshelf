/**
 * Server-side preparation of render blocks. Call it in page frontmatter before handing
 * blocks to `<Blocks>` (static or inside an island):
 *
 *   const blocks = await prepareBlocks(artifact.body.blocks);
 *
 * It pre-renders the two expensive block kinds — code (Shiki) and math (KaTeX) — to
 * HTML, so neither library ships to the browser. Unprepared blocks still render: the
 * hydrated components lazy-load the library, and static output falls back to source.
 */
import type { CodeBlock, MathBlock, RenderBlock } from './contract';
import { highlightCode } from './highlight';
import { renderMath } from './katex';

/** Pre-rendered HTML attached to a block. Not part of the wire contract. */
export interface Rendered {
  html?: string;
}

export type PreparedCodeBlock = CodeBlock & Rendered;
export type PreparedMathBlock = MathBlock & Rendered;
export type PreparedBlock =
  | Exclude<RenderBlock, CodeBlock | MathBlock>
  | PreparedCodeBlock
  | PreparedMathBlock;

async function prepareOne(block: RenderBlock): Promise<PreparedBlock> {
  if (block.type === 'code') {
    const html = await highlightCode(block.text, block.language);
    return html ? { ...block, html } : block;
  }
  if (block.type === 'math') return { ...block, html: await renderMath(block.latex) };
  return block;
}

export function prepareBlocks(blocks: readonly RenderBlock[]): Promise<PreparedBlock[]> {
  return Promise.all(blocks.map(prepareOne));
}
