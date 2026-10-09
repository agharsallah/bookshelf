/**
 * Where the feed's content starts on the page: `--feed-top` (px from the document top, the
 * bottom of the feed's bar) on the feed, so CSS sizes a pill to end at the bottom of the
 * screen whatever the masthead and the bar above it measure. Remeasured on resize.
 */
import { useLayoutEffect, useRef } from 'react';

export function useFeedTop<Root extends HTMLElement, Bar extends HTMLElement>() {
  const root = useRef<Root>(null);
  const bar = useRef<Bar>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (!root.current || !bar.current) return;
      const top = bar.current.getBoundingClientRect().bottom + window.scrollY;
      root.current.style.setProperty('--feed-top', `${Math.round(top)}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  return { root, bar };
}
