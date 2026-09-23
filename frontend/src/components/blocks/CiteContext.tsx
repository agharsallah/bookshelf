/**
 * How cite chips behave, provided once by `<Blocks>` to every nested block.
 * `citeHref` builds the link target (default `#anchor`); `onCite`, when given,
 * intercepts the click so an island can scroll/sync panes instead of navigating.
 */
import { createContext, useContext } from 'react';
import { defaultCiteHref } from '../../lib/anchors';
import type { Anchor } from '../../lib/contract';

export interface CiteOptions {
  onCite?: ((anchor: Anchor) => void) | undefined;
  citeHref?: ((anchor: Anchor) => string) | undefined;
}

interface ResolvedCiteOptions {
  onCite?: ((anchor: Anchor) => void) | undefined;
  citeHref: (anchor: Anchor) => string;
}

const CiteContext = createContext<ResolvedCiteOptions>({ citeHref: defaultCiteHref });

export const CiteProvider = CiteContext.Provider;

export function useCite(): ResolvedCiteOptions {
  return useContext(CiteContext);
}
