/**
 * Deferred commits for optimistic triage. The review API has no "un-approve", so undo
 * works by holding the request back: an action is shown as done at once and sent after
 * `delayMs`, unless undone first. Only one action waits at a time; a new one sends the
 * previous immediately, and `flush` sends everything (on page hide).
 */

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface Scheduler {
  /** Queue `run` under `key`; sends any other waiting action first. */
  schedule(key: string, run: () => void): void;
  /** Drop the waiting action for `key`. True when there was one to drop. */
  cancel(key: string): boolean;
  /** Send whatever is waiting, now. */
  flush(): void;
  pending(): string | null;
}

export function createScheduler(delayMs: number, timers: Timers = realTimers): Scheduler {
  let waiting: { key: string; run: () => void; handle: unknown } | null = null;

  const fire = () => {
    const current = waiting;
    if (!current) return;
    waiting = null;
    timers.clear(current.handle);
    current.run();
  };

  return {
    schedule(key, run) {
      fire();
      if (delayMs <= 0) {
        run();
        return;
      }
      waiting = { key, run, handle: timers.set(fire, delayMs) };
    },
    cancel(key) {
      if (waiting?.key !== key) return false;
      timers.clear(waiting.handle);
      waiting = null;
      return true;
    },
    flush: fire,
    pending: () => waiting?.key ?? null,
  };
}
