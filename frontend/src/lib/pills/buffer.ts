/**
 * Prefetch for a pill session: keep at least `min` pills loaded ahead of the one on
 * screen, with never more than one page request in flight. The session asks after every
 * change (`top`); the buffer decides whether a request is due and drops the ask when one
 * is already on its way. A page that failed is not asked for again until the reader
 * moves (`retry`), so an outage does not turn into a request loop.
 */

/** Pills kept loaded ahead of the current one (docs/PILLS.md §8). */
export const PREFETCH_AHEAD = 5;

export interface BufferView {
  /** Pills loaded after the current one. */
  ahead: number;
  /** Where the next page starts; null when the server has nothing more. */
  cursor: string | null;
  /** The session's length is reached. */
  done: boolean;
}

export function shouldFetch(view: BufferView, min = PREFETCH_AHEAD): boolean {
  return !view.done && view.cursor !== null && view.ahead < min;
}

export interface BufferOptions<P> {
  fetchPage: (cursor: string) => Promise<P>;
  onPage: (page: P) => void;
  onError?: (error: unknown) => void;
  min?: number;
}

export interface PillBuffer {
  /**
   * Fetch the next page if the view runs low; returns the request in flight, if any.
   * `retry` asks again for a page that failed.
   */
  top(view: BufferView, options?: { retry?: boolean }): Promise<void> | null;
  readonly loading: boolean;
}

export function createBuffer<P>({ fetchPage, onPage, onError, min = PREFETCH_AHEAD }: BufferOptions<P>): PillBuffer {
  let inFlight: Promise<void> | null = null;
  let failed: string | null = null;
  return {
    top(view, { retry = false } = {}) {
      if (inFlight) return inFlight;
      const cursor = view.cursor;
      if (cursor === null || !shouldFetch(view, min) || (cursor === failed && !retry)) return null;
      // Cleared before the callbacks run, so a top-up they trigger can go out at once.
      inFlight = fetchPage(cursor).then(
        (page) => {
          inFlight = null;
          failed = null;
          onPage(page);
        },
        (error: unknown) => {
          inFlight = null;
          failed = cursor;
          onError?.(error);
        },
      );
      return inFlight;
    },
    get loading() {
      return inFlight !== null;
    },
  };
}
