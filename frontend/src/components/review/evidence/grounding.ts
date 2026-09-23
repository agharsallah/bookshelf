/**
 * What drags grounding down (§14): leaf spans without a cite. Mirrors the backend's
 * `leaf_spans` (any `{text, cites}`), so quotes and code listings count too; text the
 * body adapter added for structure is excluded.
 */
import { spansOf, type RenderBlock, type Span } from '../../../lib/contract';
import { isSynthetic } from '../body/adapters';

export function isUncited(span: Span): boolean {
  return span.cites.length === 0 && !isSynthetic(span);
}

/** Leaf spans that are claims: span-bearing blocks' spans, plus quote and code blocks. */
function claims(block: RenderBlock): { cited: boolean }[] {
  if (block.type === 'quote' || block.type === 'code') return [{ cited: block.cites.length > 0 }];
  return spansOf(block)
    .filter((s) => !isSynthetic(s))
    .map((s) => ({ cited: s.cites.length > 0 }));
}

export interface GroundingTally {
  total: number;
  cited: number;
  /** Indexes of blocks holding at least one uncited claim. */
  blocks: number[];
}

export function tallyGrounding(blocks: readonly RenderBlock[]): GroundingTally {
  let total = 0;
  let cited = 0;
  const flagged: number[] = [];
  blocks.forEach((block, index) => {
    const list = claims(block);
    total += list.length;
    const ok = list.filter((c) => c.cited).length;
    cited += ok;
    if (ok < list.length) flagged.push(index);
  });
  return { total, cited, blocks: flagged };
}
