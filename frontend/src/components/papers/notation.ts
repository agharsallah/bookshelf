/**
 * The notation table's view model (pure): symbols with their KaTeX HTML attached (pre-
 * rendered in frontmatter, so KaTeX never ships for the tab), and the search filter
 * that matches a symbol by its meaning or by its LaTeX written loosely ("sigma", "g_i").
 */
import type { TreeNode } from '../../lib/api/types/documents';
import { isContainer } from '../../lib/api/types/documents';
import { isUnder } from '../../lib/documents/tree';
import type { NotationSymbol } from './study-bodies';

export interface PreparedSymbol extends NotationSymbol {
  /** KaTeX HTML; without it the LaTeX source shows (and the island renders it lazily). */
  html?: string | undefined;
  /** The paper's own heading of the section of first use ("3.2 Attention"), when known. */
  firstPlace?: string | undefined;
}

/** `\sigma` → `sigma`, `g_{i}` → `gi`: what someone typing a symbol would write. */
export function looseLatex(latex: string): string {
  return latex.toLowerCase().replace(/\\(mathrm|mathbf|mathcal|boldsymbol|text|hat|bar|tilde|vec)\b/g, '').replace(/[\\{}_^\s]/g, '');
}

/** Symbols whose meaning contains the query, or whose LaTeX matches it loosely; all when blank. */
export function filterSymbols<S extends NotationSymbol>(symbols: readonly S[], query: string): S[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...symbols];
  const loose = looseLatex(q);
  return symbols.filter((s) => s.meaning.toLowerCase().includes(q) || (loose !== '' && looseLatex(s.latex).includes(loose)));
}

export async function prepareSymbols(symbols: readonly NotationSymbol[], render: (latex: string) => Promise<string>): Promise<PreparedSymbol[]> {
  return Promise.all(symbols.map(async (s) => ({ ...s, html: await render(s.latex).catch(() => undefined) })));
}

/**
 * The heading of the innermost section holding `anchor`, as the paper prints it
 * ("3.2.1 Scaled Dot-Product Attention"): anchors number sections by position
 * (`ch04/s02/s01`), which is not the paper's numbering. Null outside every heading.
 */
export function sectionHeading(nodes: readonly TreeNode[], anchor: string): string | null {
  for (const node of nodes) {
    if (!isContainer(node.kind) || !isUnder(anchor, node.anchor)) continue;
    return sectionHeading(node.children, anchor) ?? (node.heading?.trim() || null);
  }
  return null;
}

/** Symbols with `firstPlace` taken from the outline (containers, any depth). */
export function placeSymbols<S extends NotationSymbol>(symbols: readonly S[], nodes: readonly TreeNode[]): (S & { firstPlace?: string })[] {
  return symbols.map((s) => {
    const place = s.firstAnchor ? sectionHeading(nodes, s.firstAnchor) : null;
    return place ? { ...s, firstPlace: place } : s;
  });
}
