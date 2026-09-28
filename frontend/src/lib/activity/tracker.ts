/**
 * The attention clock, for the whole app: one module that no page owns (like the audio
 * player), so it keeps counting across `ClientRouter` page swaps and reports in batches.
 *
 * Pages say where attention is (`watch`, via `useAttention` or `ActivityBeacon`); a tick
 * every `TICK_MS` counts that time only while the page is visible and you touched it
 * recently (`IDLE_MS`): a book left open on the desk is not reading. Audio counts itself
 * (`count`) while it actually plays, visible page or not. Reports go out every `FLUSH_MS`
 * and when the page is hidden or left (`keepalive`), and failed ones go with the next.
 */
import { browserApi, type ApiClient } from '../api/client';
import { ApiError } from '../api/errors';
import { ActivityLog, type Entry, type Where } from './log';

export const TICK_MS = 5_000;
export const IDLE_MS = 120_000;
export const FLUSH_MS = 60_000;
const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;
const MAX_BATCH = 500;

export interface TrackerDeps {
  api: Pick<ApiClient, 'post'>;
  now: () => number;
  visible: () => boolean;
}

export class ActivityTracker {
  private readonly log = new ActivityLog();
  private readonly watching: { id: number; where: Where }[] = [];
  private nextId = 0;
  private lastInput: number;
  private lastTick: number;
  private sending = false;

  constructor(private readonly deps: TrackerDeps) {
    this.lastInput = deps.now();
    this.lastTick = deps.now();
  }

  /** You did something: attention is here for the next `IDLE_MS`. */
  touched = (): void => {
    this.lastInput = this.deps.now();
  };

  /** Attention is on `where` until the returned function is called; the latest watch wins. */
  watch(where: Where): () => void {
    const id = this.nextId++;
    this.tick(); // time so far belongs to what was watched before
    this.watching.push({ id, where });
    this.touched();
    return () => {
      this.tick();
      const at = this.watching.findIndex((w) => w.id === id);
      if (at >= 0) this.watching.splice(at, 1);
    };
  }

  /** Count seconds directly (audio playing). */
  count(where: Where, seconds: number): void {
    this.log.add(where, seconds, this.deps.now());
  }

  /** Credit the time since the last tick to what is watched, if you were there. */
  tick(): void {
    const now = this.deps.now();
    const elapsed = Math.min(now - this.lastTick, TICK_MS * 2);
    this.lastTick = now;
    const current = this.watching.at(-1);
    if (!current || !this.deps.visible() || now - this.lastInput > IDLE_MS) return;
    this.log.add(current.where, elapsed / 1000, now);
  }

  /** Send what has been counted. Failed reports are kept for the next flush. */
  async flush(keepalive = false): Promise<void> {
    this.tick();
    if (this.sending && !keepalive) return;
    const entries = this.log.drain(this.deps.now());
    if (entries.length === 0) return;
    this.sending = true;
    try {
      for (let i = 0; i < entries.length; i += MAX_BATCH) {
        await this.send(entries.slice(i, i + MAX_BATCH), keepalive);
      }
    } finally {
      this.sending = false;
    }
  }

  private async send(entries: Entry[], keepalive: boolean): Promise<void> {
    try {
      await this.deps.api.post('activity', { entries }, { keepalive });
    } catch (error) {
      // A refused batch (422: a bad clock) would be refused again; anything else is retried.
      const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (!refused) this.log.restore(entries);
    }
  }
}

let shared: ActivityTracker | null = null;

/** The app's one tracker, made and wired to the window on first use (in the browser only). */
export function activityTracker(): ActivityTracker | null {
  if (typeof window === 'undefined') return null;
  if (shared) return shared;
  const tracker = new ActivityTracker({
    api: browserApi,
    now: () => Date.now(),
    visible: () => window.document.visibilityState === 'visible',
  });
  for (const type of INPUT_EVENTS) window.addEventListener(type, tracker.touched, { passive: true, capture: true });
  window.setInterval(() => tracker.tick(), TICK_MS);
  window.setInterval(() => void tracker.flush(), FLUSH_MS);
  const leave = () => void tracker.flush(true);
  window.addEventListener('pagehide', leave);
  window.document.addEventListener('visibilitychange', () => {
    if (window.document.visibilityState === 'hidden') leave();
    else tracker.touched();
  });
  shared = tracker;
  return tracker;
}
