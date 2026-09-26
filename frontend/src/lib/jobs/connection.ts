/**
 * One long-lived `GET /jobs/stream` subscription that survives the server going away.
 *
 * The browser's own `EventSource` retry is not enough: after `event: end` the server
 * closes the stream on purpose (`max_seconds`, or `shutdown` while `fastapi dev`
 * reloads), and a failed reconnect that answers with an error status (the proxy's 502
 * while the backend is down) closes an `EventSource` for good. So every end or error
 * closes the source and this module opens a fresh one: at once after a routine
 * `max_seconds` end, otherwise after an exponential backoff that resets once a
 * connection opens. The server re-sends a snapshot of live jobs on every connect,
 * which the reducer in ./stream.ts merges idempotently.
 */
import type { JobPublic, QueueStatus } from '../api/types/jobs';
import { parseData } from '../sse';
import { parseJobEvent, parseQueueEvent } from './stream';

/** The part of `EventSource` used here, so tests can drive a fake. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type ConnectionEvent = 'open' | 'error' | 'end';

export interface JobStreamConnection {
  url: string;
  onJob: (job: JobPublic) => void;
  onQueue?: (queue: QueueStatus) => void;
  onStatus: (event: ConnectionEvent) => void;
  create?: (url: string) => EventSourceLike;
  timers?: Timers;
  baseMs?: number;
  maxMs?: number;
}

/** 1 s, 2 s, 4 s … capped: the wait before reconnect attempt `attempt` (0-based). */
export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

/** Connect and keep reconnecting until the returned function is called. */
export function connectJobStream({
  url,
  onJob,
  onQueue,
  onStatus,
  create = (target) => new EventSource(target),
  timers = realTimers,
  baseMs = 1000,
  maxMs = 30_000,
}: JobStreamConnection): () => void {
  let source: EventSourceLike | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let stopped = false;

  const reconnect = (delay: number) => {
    source?.close();
    source = null;
    if (stopped || timer !== null) return;
    timer = timers.set(() => {
      timer = null;
      open();
    }, delay);
  };

  const open = () => {
    if (stopped) return;
    const current = create(url);
    source = current;
    current.addEventListener('open', () => {
      attempt = 0;
      onStatus('open');
    });
    current.addEventListener('job', (event) => {
      const job = parseJobEvent(event.data);
      if (job) onJob(job);
    });
    current.addEventListener('queue', (event) => {
      const queue = parseQueueEvent(event.data);
      if (queue) onQueue?.(queue);
    });
    current.addEventListener('end', (event) => {
      if (source !== current) return;
      onStatus('end');
      const reason = parseData<{ reason?: string }>(event.data)?.reason;
      // A routine end (the stream's time limit) reconnects at once; a shutdown waits.
      reconnect(reason === 'max_seconds' ? 0 : backoffDelay(attempt++, baseMs, maxMs));
    });
    current.addEventListener('error', () => {
      if (source !== current) return;
      onStatus('error');
      reconnect(backoffDelay(attempt++, baseMs, maxMs));
    });
  };

  open();
  return () => {
    stopped = true;
    if (timer !== null) timers.clear(timer);
    timer = null;
    source?.close();
    source = null;
  };
}
