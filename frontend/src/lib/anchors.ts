/**
 * Anchor helpers. Anchors are stable block addresses (`ch03/s02/p014`); cite chips
 * show a compact, book-like label for them (`3.2 ¶14`) and the full address on hover.
 */
import type { Anchor } from './contract';

const SEGMENT = /^([a-z]+)(\d+)$/;

/** Compact label: numbered segments joined by dots, a trailing paragraph as a pilcrow. */
export function anchorLabel(anchor: Anchor): string {
  const parts = anchor.split('/').map((segment) => {
    const match = SEGMENT.exec(segment);
    return match ? { kind: match[1], n: String(Number(match[2])) } : { kind: '', n: segment };
  });
  const last = parts.at(-1);
  if (last?.kind === 'p') {
    const head = parts.slice(0, -1).map((p) => p.n).join('.');
    return head ? `${head} ¶${last.n}` : `¶${last.n}`;
  }
  return parts.map((p) => p.n).join('.');
}

/** Default cite target: an in-page fragment for the anchor. */
export function defaultCiteHref(anchor: Anchor): string {
  return `#${anchor}`;
}
