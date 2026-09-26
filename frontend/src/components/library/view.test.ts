// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { bootstrapView, readView, saveView, VIEW_STORAGE_KEY, viewBootstrapScript } from './view';

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};
const blocked = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('readView and saveView', () => {
  it('defaults to the shelf, and remembers the list', () => {
    const storage = memory();
    expect(readView(storage)).toBe('shelf');
    expect(saveView(storage, 'list')).toBe(true);
    expect(storage.data.get(VIEW_STORAGE_KEY)).toBe('list');
    expect(readView(storage)).toBe('list');
  });

  it('ignores unknown values and blocked or missing storage', () => {
    expect(readView(memory({ [VIEW_STORAGE_KEY]: 'grid' }))).toBe('shelf');
    expect(readView(blocked)).toBe('shelf');
    expect(readView(undefined)).toBe('shelf');
    expect(saveView(blocked, 'list')).toBe(false);
    expect(saveView(undefined, 'list')).toBe(false);
  });
});

describe('bootstrapView', () => {
  const root = () => {
    const el = document.createElement('div');
    el.className = 'library view-shelf';
    return el;
  };

  it('swaps the shelf class for the list class when the list was chosen', () => {
    const el = root();
    bootstrapView(el, { localStorage: memory({ [VIEW_STORAGE_KEY]: 'list' }) });
    expect(el.className).toBe('library view-list');
  });

  it('keeps the server’s shelf otherwise, even when storage throws', () => {
    const el = root();
    bootstrapView(el, { localStorage: blocked });
    expect(el.className).toBe('library view-shelf');
  });

  it('is self-contained, so it still works once stringified inline', () => {
    const el = root();
    const run = new Function('document', 'window', viewBootstrapScript);
    localStorage.setItem(VIEW_STORAGE_KEY, 'list');
    run({ currentScript: { parentElement: el } }, { localStorage });
    expect(el.classList.contains('view-list')).toBe(true);
    localStorage.clear();
  });
});
