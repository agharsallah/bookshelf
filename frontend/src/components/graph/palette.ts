/**
 * Canvas colours come from the same tokens as the rest of the UI. Tokens are
 * `light-dark()` pairs, which a canvas cannot read, so each is resolved through a hidden
 * probe element's computed colour, and re-resolved when the theme changes.
 */
import { useEffect, useState, type RefObject } from 'react';
import { ENTITY_KINDS, type EntityKind } from '../../lib/api/types/graph';
import { KIND_STYLES, LINK_KINDS, LINK_STYLES, type LinkKind } from './styles';

export interface GraphPalette {
  ink: string;
  ink2: string;
  ink3: string;
  paper: string;
  /** Ring guides, like a chart's gridlines. */
  grid: string;
  accent: string;
  /** The highlighter under the focus's name: "you are here". */
  marker: string;
  markerInk: string;
  kinds: Record<EntityKind, string>;
  /** Every drawable line, stored relations and derived ones alike. */
  relations: Record<LinkKind, string>;
}

const BASE = {
  ink: '--ink',
  ink2: '--ink-2',
  ink3: '--ink-3',
  paper: '--paper',
  grid: '--chart-axis',
  accent: '--accent',
  marker: '--marker',
  markerInk: '--marker-ink',
} as const;

/** Resolve tokens with `resolve(token) → css colour`; the probe does it in the browser. */
export function buildPalette(resolve: (token: string) => string): GraphPalette {
  const base = Object.fromEntries(Object.entries(BASE).map(([k, token]) => [k, resolve(token)])) as Record<keyof typeof BASE, string>;
  return {
    ...base,
    kinds: Object.fromEntries(ENTITY_KINDS.map((k) => [k, resolve(KIND_STYLES[k].color)])) as Record<EntityKind, string>,
    relations: Object.fromEntries(LINK_KINDS.map((r) => [r, resolve(LINK_STYLES[r].color)])) as Record<LinkKind, string>,
  };
}

export function readPalette(host: HTMLElement): GraphPalette {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  try {
    return buildPalette((token) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color || '#000';
    });
  } finally {
    probe.remove();
  }
}

/** The palette for `host`, refreshed when `data-theme` or the OS scheme changes. */
export function useGraphPalette(host: RefObject<HTMLElement | null>): GraphPalette | null {
  const [palette, setPalette] = useState<GraphPalette | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const refresh = () => setPalette(readPalette(el));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', refresh);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', refresh);
    };
  }, [host]);
  return palette;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
