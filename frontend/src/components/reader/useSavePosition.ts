/**
 * `useSavePosition` — keeps the chapter's reading position on the server
 * (`PUT /documents/{ref}/reading`) as the block being read changes: debounced while
 * scrolling, flushed when the page is hidden or left. Opening a chapter and leaving
 * without scrolling does not move your place; reaching the bottom of the page finishes it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserApi } from '../../lib/api/client';

export const SAVE_DELAY_MS = 1500;

interface PositionBody {
  unit: string;
  anchor: string;
  progress: number;
}

/** Within a few pixels of the bottom of the page. */
function atPageEnd(): boolean {
  const root = window.document.documentElement;
  return window.innerHeight + window.scrollY >= root.scrollHeight - 4;
}

function usePageEnd(): boolean {
  const [end, setEnd] = useState(false);
  useEffect(() => {
    const check = () => setEnd(atPageEnd());
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);
  return end;
}

export function useSavePosition(slug: string, unit: string, active: string | null, progress: number): void {
  const pending = useRef<PositionBody | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The block the reader landed on; `null` once you have moved from it.
  const landed = useRef<string | null | undefined>(undefined);
  const end = usePageEnd();

  const flush = useCallback(
    (keepalive = false) => {
      clearTimeout(timer.current);
      const body = pending.current;
      if (!body) return;
      pending.current = null;
      browserApi.put(`documents/${encodeURIComponent(slug)}/reading`, body, { keepalive }).catch(() => {
        // Progress is a convenience: a failed save just keeps the previous place.
      });
    },
    [slug],
  );

  useEffect(() => {
    if (!active) return;
    if (landed.current === undefined) landed.current = active;
    if (active === landed.current && !end) return;
    landed.current = null;
    pending.current = { unit, anchor: active, progress: end ? 1 : progress };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), SAVE_DELAY_MS);
  }, [unit, active, progress, end, flush]);

  useEffect(() => {
    const leave = () => flush(true);
    const onVisibility = () => {
      if (window.document.visibilityState === 'hidden') leave();
    };
    window.addEventListener('pagehide', leave);
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', leave);
      window.document.removeEventListener('visibilitychange', onVisibility);
      leave();
    };
  }, [flush]);
}
