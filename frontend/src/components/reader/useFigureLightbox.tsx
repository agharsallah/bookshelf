/**
 * `useFigureLightbox` — the reader's lightbox state: open one of the chapter's
 * figures (browsable with previous / next) or a drawing from the distillation
 * pane (on its own). "Show in text" closes it and reveals the figure's passage.
 */
import { useCallback, useState, type ReactNode } from 'react';
import type { MagnifyTarget } from '../blocks/MagnifyContext';
import { Lightbox, type LightboxItem } from '../figures/Lightbox';

export function useFigureLightbox(
  figures: readonly LightboxItem[],
  reveal: (anchor: string) => void,
  /** The line under a magnified drawing: where it comes from. */
  drawingMeta = 'From the distillation',
): { openFigure: (anchor: string) => void; openDrawing: (target: MagnifyTarget) => void; open: boolean; lightbox: ReactNode } {
  const [state, setState] = useState<{ items: readonly LightboxItem[]; index: number } | null>(null);

  const openFigure = useCallback(
    (anchor: string) => {
      const index = figures.findIndex((f) => f.id === anchor);
      if (index >= 0) setState({ items: figures, index });
    },
    [figures],
  );

  const openDrawing = useCallback((target: MagnifyTarget) => {
    setState({ items: [{ id: 'drawing', kind: 'svg', html: target.html, title: target.title, alt: target.alt, meta: drawingMeta }], index: 0 });
  }, [drawingMeta]);

  const lightbox = state ? (
    <Lightbox
      items={state.items}
      index={state.index}
      onIndex={(index) => setState((s) => (s ? { ...s, index } : s))}
      onClose={() => setState(null)}
      onReveal={(anchor) => {
        setState(null);
        // After the dialog has handed focus back, so the reveal's focus sticks.
        requestAnimationFrame(() => reveal(anchor));
      }}
    />
  ) : null;

  return { openFigure, openDrawing, open: state !== null, lightbox };
}
