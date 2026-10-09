/**
 * A pill session as a state machine (docs/PILLS.md §6, §8): start or resume, move down
 * and up the feed, step through a thread sideways, end, and finish on a summary.
 *
 * The feed is a list of *groups*: a lone pill, or a thread's pills in order. Down and up
 * move between groups; left and right move within one. `sessionReducer` is pure; the
 * controller adds the calls (start, pages through the prefetch buffer, finish) and lets
 * any view subscribe. No DOM, no React.
 */
import { createBuffer, type PillBuffer } from './buffer';
import type { PillsClient } from './client';
import type { Pill, PillSession, SessionContinuation, SessionStart, SessionSummary, StartRequest, Supply } from './types';

/**
 * idle → loading → active → ending → ended. `error` only when the session never
 * started; a failed page or finish keeps the status and sets `error`.
 */
export type SessionStatus = 'idle' | 'loading' | 'active' | 'ending' | 'ended' | 'error';

export interface PillGroup {
  /** The thread key, or the lone pill's id. */
  key: string;
  pills: Pill[];
}

export interface SessionState {
  status: SessionStatus;
  sessionId: string | null;
  session: PillSession | null;
  pills: Pill[];
  groups: PillGroup[];
  /** The group on screen. */
  position: number;
  /** The pill within that group. */
  step: number;
  cursor: string | null;
  /** Nothing more will be served. */
  done: boolean;
  supply: Supply | null;
  notice: string | null;
  summary: SessionSummary | null;
  error: string | null;
}

export type SessionAction =
  | { type: 'loading' }
  | { type: 'started'; start: SessionStart }
  | { type: 'resumed'; sessionId: string; page: SessionContinuation }
  | { type: 'page'; page: SessionContinuation }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'stepRight' }
  | { type: 'stepLeft' }
  | { type: 'goto'; position: number }
  | { type: 'end' }
  | { type: 'finished'; summary: SessionSummary }
  | { type: 'failed'; error: string }
  | { type: 'supply'; supply: Supply };

export const initialSessionState: SessionState = {
  status: 'idle',
  sessionId: null,
  session: null,
  pills: [],
  groups: [],
  position: 0,
  step: 0,
  cursor: null,
  done: false,
  supply: null,
  notice: null,
  summary: null,
  error: null,
};

/** Consecutive pills of one thread form a group, in thread order; every other pill stands alone. */
export function groupPills(pills: readonly Pill[]): PillGroup[] {
  const groups: PillGroup[] = [];
  for (const pill of pills) {
    const last = groups[groups.length - 1];
    if (pill.thread && last && last.key === pill.thread.key) last.pills.push(pill);
    else groups.push({ key: pill.thread?.key ?? pill.id, pills: [pill] });
  }
  for (const group of groups) {
    if (group.pills.length > 1) group.pills.sort((a, b) => (a.thread?.index ?? 0) - (b.thread?.index ?? 0));
  }
  return groups;
}

export function currentPill(state: Pick<SessionState, 'groups' | 'position' | 'step'>): Pill | null {
  return state.groups[state.position]?.pills[state.step] ?? null;
}

/** The current pill's place in the whole feed (0-based). */
export function flatIndex(state: Pick<SessionState, 'groups' | 'position' | 'step'>): number {
  let index = 0;
  for (let i = 0; i < state.position && i < state.groups.length; i += 1) index += state.groups[i]?.pills.length ?? 0;
  return index + state.step;
}

/** Pills loaded past the current group (a thread's own pills are on screen already). */
export function pillsAhead(state: Pick<SessionState, 'groups' | 'position'>): number {
  return state.groups.slice(state.position + 1).reduce((n, g) => n + g.pills.length, 0);
}

function withPills(state: SessionState, incoming: readonly Pill[]): SessionState {
  const known = new Set(state.pills.map((p) => p.id));
  const pills = [...state.pills, ...incoming.filter((p) => !known.has(p.id))];
  return { ...state, pills, groups: groupPills(pills) };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'loading':
      return { ...initialSessionState, status: 'loading' };
    case 'started': {
      const { session, page, supply, notice } = action.start;
      const next = withPills({ ...initialSessionState, status: 'active', sessionId: session.id, session, supply, notice: notice ?? null }, page.pills);
      return { ...next, cursor: page.next_cursor, done: page.next_cursor === null };
    }
    case 'resumed': {
      const { page } = action;
      const next = withPills({ ...initialSessionState, status: 'active', sessionId: action.sessionId, supply: page.supply, notice: page.notice ?? null }, page.pills);
      return { ...next, cursor: page.next_cursor, done: page.done || page.next_cursor === null };
    }
    case 'page': {
      const { page } = action;
      const next = withPills(state, page.pills);
      return { ...next, cursor: page.next_cursor, done: page.done || page.next_cursor === null, supply: page.supply, error: null };
    }
    case 'next': {
      if (state.status !== 'active') return state;
      if (state.position < state.groups.length - 1) return { ...state, position: state.position + 1, step: 0 };
      // Past the last pill of a finished feed: the end card.
      return state.done ? { ...state, status: 'ending' } : state;
    }
    case 'previous':
      if (state.status !== 'active' || state.position === 0) return state;
      return { ...state, position: state.position - 1, step: 0 };
    case 'stepRight': {
      const size = state.groups[state.position]?.pills.length ?? 0;
      return state.step < size - 1 ? { ...state, step: state.step + 1 } : state;
    }
    case 'stepLeft':
      return state.step > 0 ? { ...state, step: state.step - 1 } : state;
    case 'goto': {
      const position = Math.max(0, Math.min(action.position, state.groups.length - 1));
      return position === state.position || state.status !== 'active' ? state : { ...state, position, step: 0 };
    }
    case 'end':
      return state.status === 'active' ? { ...state, status: 'ending' } : state;
    case 'finished':
      return { ...state, status: 'ended', summary: action.summary, error: null };
    case 'failed':
      return { ...state, status: state.status === 'loading' ? 'error' : state.status, error: action.error };
    case 'supply':
      return { ...state, supply: action.supply };
  }
}

export interface SessionController {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  start(request: StartRequest): Promise<void>;
  /** Pick up a session from where it was left (on any client). */
  resume(sessionId: string): Promise<void>;
  next(): void;
  previous(): void;
  stepRight(): void;
  stepLeft(): void;
  /** The view scrolled to another group. */
  goto(position: number): void;
  /** End now: finish on the summary. */
  end(): void;
  setSupply(supply: Supply): void;
}

export interface SessionControllerOptions {
  client: Pick<PillsClient, 'startSession' | 'page' | 'finish'>;
  pageSize?: number;
  prefetchAhead?: number;
  /** Runs before the session is finished (send the waiting events, so the summary counts them). */
  beforeFinish?: () => Promise<unknown>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

export function createSessionController({ client, pageSize = 10, prefetchAhead, beforeFinish }: SessionControllerOptions): SessionController {
  let state = initialSessionState;
  let finishing = false;
  const listeners = new Set<() => void>();

  const buffer: PillBuffer = createBuffer<SessionContinuation>({
    fetchPage: (cursor) => {
      const id = state.sessionId;
      if (!id) return Promise.reject(new Error('No session.'));
      return client.page(id, { cursor, limit: pageSize });
    },
    onPage: (page) => dispatch({ type: 'page', page }),
    onError: (error) => dispatch({ type: 'failed', error: messageOf(error) }),
    ...(prefetchAhead === undefined ? {} : { min: prefetchAhead }),
  });

  const topUp = (retry: boolean) => {
    if (state.status !== 'active') return;
    void buffer.top({ ahead: pillsAhead(state), cursor: state.cursor, done: state.done }, { retry });
  };

  const finish = async () => {
    const id = state.sessionId;
    if (finishing || !id) return;
    finishing = true;
    try {
      await beforeFinish?.().catch(() => undefined);
      dispatch({ type: 'finished', summary: await client.finish(id) });
    } catch (error) {
      dispatch({ type: 'failed', error: messageOf(error) });
    } finally {
      finishing = false;
    }
  };

  function dispatch(action: SessionAction, retry = false): void {
    const before = state;
    state = sessionReducer(state, action);
    if (state !== before) listeners.forEach((listener) => listener());
    if (state.status === 'ending' && before.status !== 'ending') void finish();
    topUp(retry);
  }

  const load = async (run: () => Promise<SessionAction>) => {
    dispatch({ type: 'loading' });
    try {
      dispatch(await run());
    } catch (error) {
      dispatch({ type: 'failed', error: messageOf(error) });
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: (request) => load(async () => ({ type: 'started', start: await client.startSession(request) })),
    resume: (sessionId) => load(async () => ({ type: 'resumed', sessionId, page: await client.page(sessionId, { limit: pageSize }) })),
    next: () => dispatch({ type: 'next' }, true),
    previous: () => dispatch({ type: 'previous' }, true),
    stepRight: () => dispatch({ type: 'stepRight' }),
    stepLeft: () => dispatch({ type: 'stepLeft' }),
    goto: (position) => dispatch({ type: 'goto', position }, true),
    end: () => {
      // A failed finish leaves the status at `ending`; ending again retries it.
      if (state.status === 'ending') void finish();
      else dispatch({ type: 'end' });
    },
    setSupply: (supply) => dispatch({ type: 'supply', supply }),
  };
}
