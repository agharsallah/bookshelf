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
