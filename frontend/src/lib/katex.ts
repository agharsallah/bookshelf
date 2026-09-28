/** KaTeX rendering, shared by `prepareBlocks` (server) and the math block's client fallback. */
import type katexType from 'katex';

type Katex = typeof katexType;

const OPTIONS = { displayMode: true, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' } as const;

/** Render with an already-loaded KaTeX (sync). Invalid LaTeX renders as a red source string, never throws. */
export function renderMathWith(katex: Katex, latex: string): string {
  return katex.renderToString(latex, OPTIONS);
}

/** Lazy-load KaTeX and render. */
export async function renderMath(latex: string): Promise<string> {
  const { default: katex } = await import('katex');
  return renderMathWith(katex, latex);
}

const INLINE = { ...OPTIONS, displayMode: false } as const;

/** Inline KaTeX (a symbol in running text or a table cell); lazy-loaded, never throws. */
export async function renderInlineMath(latex: string): Promise<string> {
  const { default: katex } = await import('katex');
  return katex.renderToString(latex, INLINE);
}
