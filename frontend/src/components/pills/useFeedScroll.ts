/**
 * Keeps the snap-scrolling feed and the session's position in step, both ways: a swipe or
 * wheel that settles on another slide moves the session there; a key or button that moves
 * the session scrolls its slide into view (instantly when motion is reduced). The slide
 * after the last pill, once the session is done, ends it.
 */
import { useCallback, useEffect, useRef } from 'react';

export interface FeedScrollOptions {
  position: number;
  /** Slides in the feed, the closing one included. */
  count: number;
  onSettle: (position: number) => void;
}

/** How much of a slide must show for it to count as the one on screen. */
const SETTLED = 0.6;

export function useFeedScroll({ position, count, onSettle }: FeedScrollOptions) {
  const scroller = useRef<HTMLDivElement>(null);
  const slides = useRef(new Map<number, HTMLElement>());
  const settled = useRef(position);
  const settle = useRef(onSettle);
  settle.current = onSettle;

  const slideRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (el) slides.current.set(index, el);
      else slides.current.delete(index);
    },
    [],
  );

  // Scroll → session.
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < SETTLED) continue;
          const index = Number((entry.target as HTMLElement).dataset.position);
          if (Number.isNaN(index) || index === settled.current) continue;
          settled.current = index;
          settle.current(index);
        }
      },
      { root, threshold: [SETTLED] },
    );
    slides.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [count]);

  // Session → scroll. Only the feed scrolls: `scrollIntoView` would move the page too and
  // tuck the slide under the sticky masthead.
  useEffect(() => {
    if (settled.current === position) return;
    settled.current = position;
    const root = scroller.current;
    const el = slides.current.get(position);
    if (!root || !el) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTo?.({ top, behavior: reduced ? 'auto' : 'smooth' });
  }, [position]);

  return { scroller, slideRef };
}
