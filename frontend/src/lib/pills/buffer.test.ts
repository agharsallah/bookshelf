import { describe, expect, it, vi } from 'vitest';
import { createBuffer, PREFETCH_AHEAD, shouldFetch } from './buffer';

describe('shouldFetch', () => {
  it('asks for more only when fewer than five are ahead and more can come', () => {
    expect(PREFETCH_AHEAD).toBe(5);
    expect(shouldFetch({ ahead: 4, cursor: 'c', done: false })).toBe(true);
    expect(shouldFetch({ ahead: 5, cursor: 'c', done: false })).toBe(false);
    expect(shouldFetch({ ahead: 0, cursor: null, done: false })).toBe(false);
    expect(shouldFetch({ ahead: 0, cursor: 'c', done: true })).toBe(false);
  });
});

describe('createBuffer', () => {
  it('keeps one request in flight however often it is asked', async () => {
    let release: (page: string) => void = () => undefined;
    const fetchPage = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const onPage = vi.fn();
    const buffer = createBuffer({ fetchPage, onPage });
    const low = { ahead: 1, cursor: '10', done: false };
    const first = buffer.top(low);
    expect(buffer.top(low)).toBe(first);
    expect(buffer.loading).toBe(true);
    release('page');
    await first;
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith('10');
    expect(onPage).toHaveBeenCalledWith('page');
    expect(buffer.loading).toBe(false);
  });

  it('lets the page handler top up again at once', async () => {
    const pages: string[] = [];
    const buffer = createBuffer<string>({
      fetchPage: async (cursor) => cursor,
      onPage: (page) => {
        pages.push(page);
        if (page === '10') void buffer.top({ ahead: 2, cursor: '20', done: false });
      },
    });
    await buffer.top({ ahead: 0, cursor: '10', done: false });
    await vi.waitFor(() => expect(pages).toEqual(['10', '20']));
  });

  it('does not ask again for a failed page until told to retry', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('offline');
    });
    const onError = vi.fn();
    const buffer = createBuffer({ fetchPage, onPage: vi.fn(), onError });
    const low = { ahead: 0, cursor: '10', done: false };
    await buffer.top(low);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(buffer.top(low)).toBeNull();
    await buffer.top(low, { retry: true });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('does nothing while enough are loaded', () => {
    const fetchPage = vi.fn(async () => 'x');
    expect(createBuffer({ fetchPage, onPage: vi.fn() }).top({ ahead: 9, cursor: 'c', done: false })).toBeNull();
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
