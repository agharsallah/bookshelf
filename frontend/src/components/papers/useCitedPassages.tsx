/**
 * Cites on the paper tabs open their passage in place (the guide's PassagePanel) and drawn
 * figures get a Magnify button; a cite outside every section, or any ⌘/Ctrl/middle click,
 * follows its link into the reader. Chips are labelled in the paper's section numbers. One hook, so every tab view behaves the same.
 *
 *   const { cite, onMagnify, overlays } = useCitedPassages(slug, units, 'From the paper card');
 *   <Blocks blocks={…} {...cite} onMagnify={onMagnify} /> … {overlays}
 */
import { navigate } from 'astro:transitions/client';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { Anchor } from '../../lib/contract';
import type { CiteOptions } from '../blocks/CiteContext';
import type { MagnifyHandler } from '../blocks/MagnifyContext';
import { PassagePanel, type PassageTarget } from '../guide/PassagePanel';
import { unitOfAnchor, type PassageUnit } from '../guide/passage';
import { useFigureLightbox } from '../reader/useFigureLightbox';
import { paperCiteLabel } from './cite-label';

export interface CitedPassages {
  cite: Required<Pick<CiteOptions, 'citeHref' | 'onCite'>> & { citeLabel: (anchor: Anchor) => string };
  onMagnify: MagnifyHandler;
  /** The passage drawer and the lightbox; render once, anywhere in the island. */
  overlays: ReactNode;
}

export function useCitedPassages(slug: string, units: readonly PassageUnit[], drawingMeta: string): CitedPassages {
  const [passage, setPassage] = useState<PassageTarget | null>(null);
  const readHref = useCallback((anchor: Anchor) => `/documents/${slug}/read/${anchor}`, [slug]);
  const onCite = useCallback(
    (anchor: Anchor) => {
      const unit = unitOfAnchor(units, anchor);
      if (unit) setPassage({ unit, anchor });
      else void navigate(readHref(anchor));
    },
    [units, readHref],
  );
  const { openDrawing, lightbox } = useFigureLightbox([], onCite, drawingMeta);
  const citeLabel = useMemo(() => paperCiteLabel(units), [units]);
  const cite = useMemo(() => ({ citeHref: readHref, onCite, citeLabel }), [readHref, onCite, citeLabel]);
  const overlays = (
    <>
      {passage ? (
        <PassagePanel slug={slug} units={units} target={passage} onTarget={setPassage} onClose={() => setPassage(null)} readHref={readHref} />
      ) : null}
      {lightbox}
    </>
  );
  return { cite, onMagnify: openDrawing, overlays };
}
