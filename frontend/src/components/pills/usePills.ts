/**
 * The feed's React glue over `lib/pills`: the session store, the event queue (persisted in
 * localStorage, flushed when the page is hidden), and what is recorded as pills come and
 * go — seen once, dwell on leaving, a skip when one was left within moments untouched.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PillsClient } from '../../lib/pills/client';
import { createEventQueue, type EventQueue, type Lifecycle } from '../../lib/pills/events';
import { createSessionController, type SessionController, type SessionState } from '../../lib/pills/session';
import { localStorageAdapter, type StorageAdapter } from '../../lib/pills/storage';
import type { Pill, PillEventKind, PillEventValue } from '../../lib/pills/types';

/** Left sooner than this without answering: a skip. */
export const SKIP_MS = 1500;
/** Dwell longer than this is a pill left open, not read; it is capped. */
export const MAX_DWELL_MS = 10 * 60_000;

/** The page lifecycle as the event queue wants it: hidden or leaving. */
export const pageLifecycle: Lifecycle = {
  onHide(listener) {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') listener();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', listener);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', listener);
    };
  },
};

export function useSessionStore(client: PillsClient, queue: EventQueue): { session: SessionController; state: SessionState } {
  const session = useMemo(() => createSessionController({ client, beforeFinish: () => queue.flush() }), [client, queue]);
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  return { session, state };
}

export function useEventQueue(client: PillsClient, storage?: StorageAdapter): EventQueue {
  const queue = useMemo(
    () =>
      createEventQueue({
        send: (events, { keepalive }) => client.sendEvents(events, { keepalive }),
        storage: storage ?? localStorageAdapter(),
        lifecycle: typeof document === 'undefined' ? undefined : pageLifecycle,
      }),
    [client, storage],
  );
  useEffect(() => () => queue.dispose(), [queue]);
  return queue;
}

export type Emit = (kind: PillEventKind, pill: Pill, value?: PillEventValue) => void;

/** Record events for `sessionId`; a review pill is addressed by its review item. */
export function useEmit(queue: EventQueue, sessionId: string | null): Emit {
  return useCallback(
    (kind, pill, value) => {
      queue.push({
        kind,
        session_id: sessionId,
        ...(pill.kind === 'review' ? { review_item_id: pill.review_item_id } : { pill_id: pill.id }),
        ...(value ? { value } : {}),
      });
    },
    [queue, sessionId],
  );
}

/**
 * Seen, dwell and skip for the pill on screen. `touch(pill)` marks it as interacted with
 * (answered, saved…), so leaving it quickly is not a skip.
 */
export function useDwell(current: Pill | null, emit: Emit, now: () => number = Date.now): { touch: (pill: Pill) => void } {
  const seen = useRef(new Set<string>());
  const touched = useRef(new Set<string>());
  const [since] = useState(() => ({ at: now() }));

  useEffect(() => {
    if (!current) return;
    if (!seen.current.has(current.id)) {
      seen.current.add(current.id);
      emit('seen', current);
    }
    since.at = now();
    const leave = () => {
      const ms = Math.min(MAX_DWELL_MS, now() - since.at);
      if (ms <= 0) return;
      emit('dwell', current, { ms });
      if (ms < SKIP_MS && !touched.current.has(current.id)) emit('skip', current);
    };
    // A hidden page stops the clock; coming back starts it again.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        leave();
        since.at = Number.POSITIVE_INFINITY;
      } else since.at = now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (Number.isFinite(since.at)) leave();
    };
  }, [current, emit, now, since]);

  return { touch: useCallback((pill: Pill) => void touched.current.add(pill.id), []) };
}
