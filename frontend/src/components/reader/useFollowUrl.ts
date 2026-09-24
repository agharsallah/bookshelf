/**
 * `useFollowUrl` — the address bar follows the block being read (replaceState, so
 * history is not flooded). A shared link keeps its anchor until the reader moves
 * on their own: the first wheel, touch, key or click releases it.
 */
import { useEffect, useRef } from 'react';

export function useFollowUrl(active: string | null, linkFor: (anchor: string) => string, initialAnchor: string | null): void {
  const hold = useRef(Boolean(initialAnchor));

  useEffect(() => {
    const release = () => {
      hold.current = false;
    };
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    events.forEach((e) => window.addEventListener(e, release, { once: true, passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, release));
  }, []);

  useEffect(() => {
    if (!active || hold.current) return;
    const timer = setTimeout(() => window.history.replaceState(window.history.state, '', linkFor(active)), 250);
    return () => clearTimeout(timer);
  }, [active, linkFor]);
}
