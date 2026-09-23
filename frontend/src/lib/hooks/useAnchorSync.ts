/**
 * `useAnchorSync` — which anchored element is being read. Watches every element
 * carrying `attr` under `root` with one IntersectionObserver, and on each change
 * picks the element crossing the reading line (see components/reader/active.ts).
 *
 *   const active = useAnchorSync(sourceRef, 'data-source-anchor', [blocks.length]);
 */
import { useEffect, useState, type DependencyList, type RefObject } from 'react';
import { pickActive, readingLine, type BlockBox } from '../../components/reader/active';

export function useAnchorSync(
  root: RefObject<HTMLElement | null>,
  attr: string,
  deps: DependencyList = [],
): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const container = root.current;
    if (!container || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<Element>();
    let frame = 0;

    const measure = () => {
      frame = 0;
      const boxes: BlockBox[] = [];
      for (const el of visible) {
        const rect = el.getBoundingClientRect();
        const anchor = el.getAttribute(attr);
        if (anchor) boxes.push({ anchor, top: rect.top, bottom: rect.bottom });
      }
      const next = pickActive(boxes, readingLine(window.innerHeight));
      if (next) setActive((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        schedule();
      },
      // Only the upper part of the viewport counts as "being read".
      { rootMargin: '0px 0px -45% 0px', threshold: [0, 1] },
    );
    container.querySelectorAll(`[${attr}]`).forEach((el) => observer.observe(el));
    // Crossing the line inside one tall block does not fire the observer: re-measure on scroll.
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root, attr, ...deps]);

  return active;
}
