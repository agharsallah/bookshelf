/**
 * Claim marks in the reader's margin (docs/PAPERS.md §5): `GET /documents/{ref}/claims/marks`
 * gives evidence anchors with the claims resting on them and the shelf's accepted
 * verdicts. A mark lands on its block; an anchor the reader does not draw as a block (a
 * container, or a block past a truncated chapter) goes to its nearest drawn ancestor,
 * and marks meeting on one block merge (each claim once, its verdicts counted once).
 */
import type { ClaimMark, MarkedClaim } from '../../../lib/api/types/paperStudy';

export interface BlockClaims {
  anchor: string;
  claims: MarkedClaim[];
  supported_by: number;
  contradicted_by: number;
  extended_by: number;
}

/** `ch03/s01/p002` → `ch03/s01` → `ch03`. */
function ancestors(anchor: string): string[] {
  const parts = anchor.split('/');
  return parts.map((_, i) => parts.slice(0, parts.length - i).join('/'));
}

/** Block anchor → the claims to mark on it; marks with no drawn block are dropped. */
export function claimMarksByBlock(marks: readonly ClaimMark[], drawn: ReadonlySet<string>): Map<string, BlockClaims> {
  const out = new Map<string, BlockClaims>();
  // A claim's verdicts are per claim, so a claim met twice on one block counts once.
  const seen = new Map<string, Set<string>>();
  for (const mark of marks) {
    const anchor = ancestors(mark.anchor).find((a) => drawn.has(a));
    if (!anchor) continue;
    const block = out.get(anchor) ?? { anchor, claims: [], supported_by: 0, contradicted_by: 0, extended_by: 0 };
    const ids = seen.get(anchor) ?? new Set<string>();
    const fresh = mark.claims.filter((c) => !ids.has(c.id));
    if (fresh.length === 0) continue;
    for (const claim of fresh) {
      ids.add(claim.id);
      block.claims.push(claim);
    }
    // A mark's counts are summed over its claims and cannot be split back per claim, so
    // they are added only when none of its claims was counted here already.
    if (fresh.length === mark.claims.length) {
      block.supported_by += mark.supported_by;
      block.contradicted_by += mark.contradicted_by;
      block.extended_by += mark.extended_by;
    }
    out.set(anchor, block);
    seen.set(anchor, ids);
  }
  return out;
}

export function hasVerdicts(block: Pick<BlockClaims, 'supported_by' | 'contradicted_by' | 'extended_by'>): boolean {
  return block.supported_by + block.contradicted_by + block.extended_by > 0;
}

/** The mark's accessible name: "Claims C2, C3: supported by 1 and contradicted by 2 on your shelf". */
export function claimMarkLabel(block: BlockClaims): string {
  const keys = block.claims.map((c) => c.key).join(', ');
  const head = `${block.claims.length === 1 ? 'Claim' : 'Claims'} ${keys}`;
  const parts = [
    block.supported_by ? `supported by ${block.supported_by}` : null,
    block.contradicted_by ? `contradicted by ${block.contradicted_by}` : null,
    block.extended_by ? `extended by ${block.extended_by}` : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return `${head}: nothing on your shelf relates to it yet`;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}` : parts[0];
  return `${head}: ${list} on your shelf`;
}

