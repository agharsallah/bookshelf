import { describe, expect, it } from 'vitest';
import { localStorageAdapter, memoryStorage, readJson, writeJson, type WebStorageLike } from './storage';

function webStorage(): WebStorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('memoryStorage', () => {
  it('keeps, returns and forgets values', async () => {
    const s = memoryStorage({ a: '1' });
    expect(await s.get('a')).toBe('1');
    await s.set('b', '2');
    await s.remove('a');
    expect(s.snapshot()).toEqual({ b: '2' });
    expect(await s.get('a')).toBeNull();
  });
});

describe('localStorageAdapter', () => {
  it('reads and writes through Web Storage', async () => {
    const web = webStorage();
    const s = localStorageAdapter(() => web);
    await s.set('k', 'v');
    expect(web.data.get('k')).toBe('v');
    expect(await s.get('k')).toBe('v');
    await s.remove('k');
    expect(web.data.has('k')).toBe(false);
  });

  it('never throws when storage is blocked or missing', async () => {
    const blocked = localStorageAdapter(() => {
      throw new Error('SecurityError');
    });
    await expect(blocked.get('k')).resolves.toBeNull();
    await expect(blocked.set('k', 'v')).resolves.toBeUndefined();
    const full = localStorageAdapter(() => ({ ...webStorage(), setItem: () => { throw new Error('QuotaExceeded'); } }));
    await expect(full.set('k', 'v')).resolves.toBeUndefined();
    await expect(localStorageAdapter(() => undefined).get('k')).resolves.toBeNull();
  });
});

describe('readJson / writeJson', () => {
  it('round-trips JSON and falls back on garbage', async () => {
    const s = memoryStorage({ bad: '{nope' });
    await writeJson(s, 'list', [1, 2]);
    expect(await readJson(s, 'list', [])).toEqual([1, 2]);
    expect(await readJson(s, 'bad', 'fallback')).toBe('fallback');
    expect(await readJson(s, 'missing', 0)).toBe(0);
  });
});
