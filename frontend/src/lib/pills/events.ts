/**
 * The pill event queue: what the reader does (seen, dwell, answer, save…) is recorded at
 * once and sent later, in batches (`POST /pills/events`, docs/PILLS.md §7).
 *
 * - **Idempotent**: every event gets a client-generated id when it is pushed, so a batch
 *   that is retried after a lost response is counted once by the server.
 * - **Batched**: sent when `flushAt` events are waiting, `intervalMs` after the first one,
 *   or when the page is hidden (`lifecycle.onHide`, sent with `keepalive`).
 * - **Durable**: the waiting events are written through a `StorageAdapter`, so a reload or
 *   an offline spell loses nothing; they go out with the next flush.
 * - **Patient**: a failure that may pass (network, 408, 429, 5xx) retries with doubling
 *   backoff; one that will not (another 4xx) drops that batch rather than retry forever.
 *
 * Timers, the clock, ids and the page lifecycle are injected: no DOM here.
 */
import { readJson, writeJson, type StorageAdapter } from './storage';
import { MAX_EVENT_BATCH, type PillEvent } from './types';

export const EVENTS_STORAGE_KEY = 'bookshelf:pills:events';

/** Fires `listener` when the app goes to the background (web: `visibilitychange`, `pagehide`). */
export interface Lifecycle {
  onHide(listener: () => void): () => void;
}

export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type EventInput = Omit<PillEvent, 'id' | 'at'> & Partial<Pick<PillEvent, 'id' | 'at'>>;

export interface EventQueueOptions {
  send: (events: readonly PillEvent[], options: { keepalive: boolean }) => Promise<unknown>;
  storage?: StorageAdapter;
  storageKey?: string;
  /** Send as soon as this many are waiting. */
  flushAt?: number;
  /** Send this long after the first event of a batch. */
  intervalMs?: number;
  retry?: { baseMs: number; maxMs: number };
  /** The oldest events are dropped beyond this many (a long offline spell). */
  maxPending?: number;
  lifecycle?: Lifecycle;
  timers?: Timers;
  now?: () => Date;
  newId?: () => string;
  /** Whether a failed send is worth retrying. */
  isRetryable?: (error: unknown) => boolean;
}

export interface EventQueue {
  /** Resolves once events persisted by an earlier visit are back in the queue. */
  readonly ready: Promise<void>;
  push(event: EventInput): PillEvent;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  pending(): readonly PillEvent[];
  dispose(): void;
}

/** A random RFC 4122 v4 id, from `crypto` where there is one. */
export function newEventId(): string {
  const native = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (native) return native();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Network failures, timeouts, throttling and server errors pass; other refusals do not. */
export function isRetryableError(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined;
  if (typeof status !== 'number') return true;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** The wait before retry `attempt` (1-based): base, 2×base, 4×base… capped. */
export function backoffMs(attempt: number, { baseMs, maxMs }: { baseMs: number; maxMs: number }): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

const defaultTimers: Timers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createEventQueue(options: EventQueueOptions): EventQueue {
  const {
    send,
    storage,
    storageKey = EVENTS_STORAGE_KEY,
    flushAt = 20,
    intervalMs = 15_000,
    retry = { baseMs: 2_000, maxMs: 60_000 },
    maxPending = 1_000,
    lifecycle,
    timers = defaultTimers,
    now = () => new Date(),
    newId = newEventId,
    isRetryable = isRetryableError,
  } = options;

  let queue: PillEvent[] = [];
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let failures = 0;
  let disposed = false;

  const persist = () => (storage ? writeJson(storage, storageKey, queue) : Promise.resolve());

  const schedule = (ms: number, replace = false) => {
    if (disposed) return;
    if (timer !== null) {
      if (!replace) return;
      timers.clearTimeout(timer);
    }
    timer = timers.setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
  };

  const sendBatch = async (keepalive: boolean): Promise<void> => {
    const batch = queue.slice(0, MAX_EVENT_BATCH);
    if (batch.length === 0) return;
    const sent = new Set(batch.map((e) => e.id));
    try {
      await send(batch, { keepalive });
      failures = 0;
    } catch (error) {
      if (isRetryable(error)) {
        failures += 1;
        schedule(backoffMs(failures, retry), true);
        return;
      }
      // A refusal that will not pass: drop the batch rather than block the queue.
    }
    queue = queue.filter((e) => !sent.has(e.id));
    await persist();
    if (queue.length >= flushAt || queue.length >= MAX_EVENT_BATCH) await sendBatch(keepalive);
    else if (queue.length > 0) schedule(intervalMs);
  };

  const flush = (opts: { keepalive?: boolean } = {}): Promise<void> => {
    if (inFlight) return inFlight;
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    inFlight = sendBatch(opts.keepalive ?? false).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const push = (input: EventInput): PillEvent => {
    const event: PillEvent = { ...input, id: input.id ?? newId(), at: input.at ?? now().toISOString() };
    queue.push(event);
    if (queue.length > maxPending) queue = queue.slice(queue.length - maxPending);
    void persist();
    if (queue.length >= flushAt && !inFlight && failures === 0) void flush();
    else schedule(intervalMs);
    return event;
  };

  const ready = (async () => {
    if (!storage) return;
    const stored = await readJson<PillEvent[]>(storage, storageKey, []);
    if (!Array.isArray(stored) || stored.length === 0) return;
    const known = new Set(queue.map((e) => e.id));
    queue = [...stored.filter((e) => e && typeof e.id === 'string' && !known.has(e.id)), ...queue];
    // A push made while the old queue was loading wrote only itself; write both back.
    await persist();
    // What an earlier visit left behind goes out soon, not with the next interval.
    schedule(0, true);
  })();

  const unsubscribe = lifecycle?.onHide(() => void flush({ keepalive: true }));

  return {
    ready,
    push,
    flush,
    pending: () => queue,
    dispose: () => {
      disposed = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      unsubscribe?.();
    },
  };
}
