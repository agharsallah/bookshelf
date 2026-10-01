/**
 * The chapter's magnifiable figures, in reading order: every figure and display
 * formula with an extracted image, as lightbox items (components/figures).
 */
import type { NodePublic } from '../../lib/api/types/documents';
import type { LightboxItem } from '../figures/Lightbox';

export const mediaSrc = (path: string): string => `/api/media/${path}`;

type FigureNode = Pick<NodePublic, 'anchor' | 'kind' | 'text' | 'page_from' | 'meta'>;

export function figureItems(nodes: readonly FigureNode[]): LightboxItem[] {
  let figures = 0;
  let formulas = 0;
  return nodes.flatMap((node) => {
    const path = node.meta.image_path;
    if (!path || (node.kind !== 'figure' && node.kind !== 'math')) return [];
    const isFigure = node.kind === 'figure';
    const n = isFigure ? (figures += 1) : (formulas += 1);
    const caption = node.meta.caption?.trim() || (isFigure ? node.text?.trim() : '') || '';
    const fallback = isFigure ? `Figure ${n}` : `Formula ${n}`;
    return [
      {
        id: node.anchor,
        kind: 'image' as const,
        src: mediaSrc(path),
        title: caption || fallback,
        alt: caption || node.text?.trim() || fallback,
        meta: node.page_from !== null ? `Page ${node.page_from}` : undefined,
        anchor: node.anchor,
      },
    ];
  });
}

/** A figure as the source shows it: its cropped image and where it sits in the chapter. */
export interface OriginalFigure {
  src: string;
  alt: string;
  caption: string | null;
  page: number | null;
  /** Its place among the chapter's figures, from 1. */
  n: number;
  /** How many figures the chapter has. */
  of: number;
}

/**
 * One entry of the pane's Figures tab: an original figure with the explanation made of it,
 * an original nobody has explained yet, or an explanation of a block with no image (a table, code).
 */
export interface FigureShelfItem<E> {
  anchor: string;
  original: OriginalFigure | null;
  explanation: E | null;
}

/**
 * The chapter's original figures paired with their explanations by anchor, in reading order.
 * Explanations of blocks outside `nodes` (a chapter cut short) keep their order at the end.
 */
export function figureShelf<E extends { anchor: string }>(nodes: readonly FigureNode[], explanations: readonly E[]): FigureShelfItem<E>[] {
  const byAnchor = new Map(explanations.map((e) => [e.anchor, e]));
  const originals = nodes.filter((n) => n.kind === 'figure' && n.meta.image_path);
  const numbers = new Map(originals.map((n, i) => [n.anchor, i + 1]));
  const placed = new Set<string>();
  const items = nodes.flatMap((node): FigureShelfItem<E>[] => {
    const explanation = byAnchor.get(node.anchor) ?? null;
    const n = numbers.get(node.anchor);
    if (!explanation && n === undefined) return [];
    placed.add(node.anchor);
    const caption = node.meta.caption?.trim() || null;
    const original =
      n !== undefined && node.meta.image_path
        ? { src: mediaSrc(node.meta.image_path), alt: caption ?? (node.text?.trim() || `Figure ${n}`), caption, page: node.page_from, n, of: originals.length }
        : null;
    return [{ anchor: node.anchor, original, explanation }];
  });
  const rest = explanations.filter((e) => !placed.has(e.anchor)).map((e) => ({ anchor: e.anchor, original: null, explanation: e }));
  return [...items, ...rest];
}
