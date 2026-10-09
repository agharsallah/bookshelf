/**
 * Cite chips inside a pill: each links to the reader at its passage, and a plain click
 * opens the passage in place, in the guide's drawer (`ReadInPlace`), so the feed is never
 * left to check a claim. Cross-document cites (`<slug>:<anchor>`) resolve through the
 * pill's `sources`; bare ones belong to `slug` (the pill's document, or a connection side's).
 */
import { useMemo, type ReactNode } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { Pill } from '../../lib/pills/types';
import { CiteProvider, type CiteOptions } from '../blocks/CiteContext';
import { usePassageOpener } from '../guide/ReadInPlace';
import { citeReaderHref, resolveCite } from './model';

/** The cite behaviour for a pill, to hand to `<Blocks>` or a `CiteProvider`. */
export function usePillCites(pill: Pick<Pill, 'sources'>, slug: string, onOpen?: () => void): Required<Pick<CiteOptions, 'citeHref' | 'citeLabel'>> & CiteOptions {
  const open = usePassageOpener();
  return useMemo(() => {
    const target = (cite: string) => resolveCite(pill, cite, slug);
    return {
      citeHref: (cite: string) => citeReaderHref(target(cite)),
      citeLabel: (cite: string) => anchorLabel(target(cite).anchor),
      citeTitle: (cite: string) => {
        const t = target(cite);
        return t.slug === slug ? t.anchor : `${pill.sources[cite]?.document.title ?? t.slug}, ${t.anchor}`;
      },
      onCite: open
        ? (cite: string) => {
            const t = target(cite);
            onOpen?.();
            open(t.slug, t.anchor);
          }
        : undefined,
    };
  }, [open, pill, slug, onOpen]);
}

export function PillCites({ pill, slug, onOpen, children }: { pill: Pick<Pill, 'sources'>; slug: string; onOpen?: () => void; children: ReactNode }) {
  const cite = usePillCites(pill, slug, onOpen);
  return <CiteProvider value={cite}>{children}</CiteProvider>;
}
