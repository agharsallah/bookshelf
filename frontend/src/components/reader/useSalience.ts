/**
 * The live side of the "what matters" mode: blocks with marks light up (`data-lit`,
 * which starts their draw-in) once they are well inside the viewport, and every core
 * idea or key point in a lit block counts as seen. Seen ideas are remembered per
 * chapter in localStorage, so the meter picks up where you left off.
 */
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { isIdea, type Salient } from './salience';

export const LIT_ATTR = 'data-lit';
const STORAGE_PREFIX = 'bookshelf:salience:';

export function loadSeen(key: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveSeen(key: string, seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify([...seen]));
  } catch {
    // Storage blocked or full: the meter just starts over next visit.
  }
}

export interface SalienceProgress {
  /** Core ideas and key points, in reading order. */
  ideas: readonly Salient[];
  seen: ReadonlySet<string>;
  /** The first idea after `anchor` (wrapping) not yet seen, else simply the next one. */
  nextIdea: (after: string | null, order: ReadonlyMap<string, number>) => Salient | null;
}

export function useSalience(root: RefObject<HTMLElement | null>, salients: readonly Salient[], enabled: boolean, key: string): SalienceProgress {
  const ideas = useMemo(() => salients.filter(isIdea), [salients]);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());

  // Read after mount: the server render has no storage, and the first client render must match it.
  useEffect(() => setSeen(loadSeen(key)), [key]);

  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    const blocks = [...el.querySelectorAll<HTMLElement>('[data-salient]')].filter((b) => !b.hasAttribute(LIT_ATTR));
    const light = (block: HTMLElement) => {
      block.setAttribute(LIT_ATTR, '');
      const anchor = block.dataset.sourceAnchor;
      const found = ideas.filter((s) => s.anchor === anchor).map((s) => s.id);
      if (found.length === 0) return;
      setSeen((before) => {
        if (found.every((id) => before.has(id))) return before;
        const next = new Set([...before, ...found]);
        saveSeen(key, next);
        return next;
      });
    };
    if (typeof IntersectionObserver !== 'function') {
      blocks.forEach(light);
      return;
    }
    // "Well inside": past the bottom fifth of the screen, so the stroke draws where you are looking.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue;
          light(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -20% 0px' },
    );
    blocks.forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [root, enabled, ideas, key]);

  const nextIdea = useCallback(
    (after: string | null, order: ReadonlyMap<string, number>) => {
      const from = after ? (order.get(after) ?? -1) : -1;
      const ahead = [...ideas.filter((s) => (order.get(s.anchor) ?? 0) > from), ...ideas.filter((s) => (order.get(s.anchor) ?? 0) <= from)];
      return ahead.find((s) => !seen.has(s.id)) ?? ahead[0] ?? null;
    },
    [ideas, seen],
  );

  return { ideas, seen, nextIdea };
}
