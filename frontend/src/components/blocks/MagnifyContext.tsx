/**
 * Optional "magnify" for drawn figures (diagrams, charts): an island passes
 * `onMagnify` to `<Blocks>` and each figure grows a Magnify button that hands over
 * its drawing. Static pages pass nothing and show no button.
 */
import { createContext, useContext } from 'react';

export interface MagnifyTarget {
  /** The drawing as SVG markup. */
  html: string;
  title: string;
  alt: string;
}

export type MagnifyHandler = (target: MagnifyTarget) => void;

const MagnifyContext = createContext<MagnifyHandler | null>(null);

export const MagnifyProvider = MagnifyContext.Provider;

export function useMagnify(): MagnifyHandler | null {
  return useContext(MagnifyContext);
}
