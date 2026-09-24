/**
 * Layout effects the reader applies outside its own tree: focus mode hides the
 * site chrome (a flag on <html> that BaseLayout styles), the Fullscreen API, and
 * the toolbar that slides away while you read in focus mode.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** `<html data-reader-focus>`, styled by BaseLayout. */
export const FOCUS_ATTR = 'data-reader-focus';

/** Flag <html> while focus mode is on, so the masthead and footer step aside. */
export function useFocusChrome(focus: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute(FOCUS_ATTR, focus);
    return () => root.removeAttribute(FOCUS_ATTR);
  }, [focus]);
}

function subscribeFullscreen(listener: () => void): () => void {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
}

/** Whether the page is full screen, whether it can be, and a toggle. */
export function useFullscreen(): { active: boolean; supported: boolean; toggle: () => void } {
  const active = useSyncExternalStore(subscribeFullscreen, () => Boolean(document.fullscreenElement), () => false);
  const supported = useSyncExternalStore(subscribeFullscreen, () => Boolean(document.fullscreenEnabled), () => false);
  const toggle = useCallback(() => {
    // Refusals (no user gesture, a policy) leave the page as it was.
    const done = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    done?.catch(() => undefined);
  }, []);
  return { active, supported, toggle };
}

/** Scrolled this far down before the toolbar may hide. */
const HIDE_AFTER = 160;
/** Pointer this close to the top brings it back. */
const REVEAL_ZONE = 72;

/**
 * True while the toolbar should be tucked away: `enabled` (focus mode), nothing
 * `pinned` open, and the reader scrolling down. Scrolling up or pointing at the
 * top edge brings it back.
 */
export function useAutoHide(enabled: boolean, pinned: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setHidden(y > last && y > HIDE_AFTER);
      last = y;
    };
    const onPointer = (event: PointerEvent) => {
      if (event.clientY < REVEAL_ZONE) setHidden(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onPointer);
      setHidden(false);
    };
  }, [enabled]);

  return enabled && !pinned && hidden;
}
