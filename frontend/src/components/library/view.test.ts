// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { bootstrapView, defaultClasses, PREFS, parsePref, readPref, savePref, viewBootstrapScript } from './view';

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
const TABLE = Object.entries(PREFS).map(([name, pref]) => [pref.key, name, pref.values] as const);

describe('readPref and savePref', () => {
  it('default to the shelf, dyed by kind, ungrouped, and remember a choice', () => {
    const storage = memory();
    expect([readPref(storage, 'view'), readPref(storage, 'by'), readPref(storage, 'group')]).toEqual(['shelf', 'kind', 'off']);
    expect(savePref(storage, 'by', 'reading')).toBe(true);
    expect(storage.data.get(PREFS.by.key)).toBe('reading');
    expect(readPref(storage, 'by')).toBe('reading');
  });

  it('ignore unknown values and blocked or missing storage', () => {
    expect(readPref(memory({ [PREFS.view.key]: 'grid' }), 'view')).toBe('shelf');
    expect(readPref(blocked, 'group')).toBe('off');
    expect(readPref(undefined, 'by')).toBe('kind');
    expect(savePref(blocked, 'view', 'list')).toBe(false);
    expect(savePref(undefined, 'view', 'list')).toBe(false);
  });

  it('parse a value from a button', () => {
    expect(parsePref('group', 'on')).toBe('on');
    expect(parsePref('by', undefined)).toBe('kind');
  });
});

describe('bootstrapView', () => {
  const root = () => {
    const el = document.createElement('div');
    el.className = ['library', ...defaultClasses()].join(' ');
    return el;
  };

  it('swaps in every stored choice', () => {
    const el = root();
    const storage = memory({ [PREFS.view.key]: 'list', [PREFS.by.key]: 'study', [PREFS.group.key]: 'on' });
    bootstrapView(el, { localStorage: storage }, TABLE);
    expect(el.className).toBe('library view-list by-study group-on');
  });

  it('keeps the server’s defaults for unknown values, and when storage throws', () => {
    const el = root();
    bootstrapView(el, { localStorage: memory({ [PREFS.by.key]: 'colour' }) }, TABLE);
    bootstrapView(el, { localStorage: blocked }, TABLE);
    expect(el.className).toBe('library view-shelf by-kind group-off');
  });

  it('is self-contained, so it still works once stringified inline', () => {
    const el = root();
    const run = new Function('document', 'window', viewBootstrapScript);
    localStorage.setItem(PREFS.view.key, 'list');
    run({ currentScript: { parentElement: el } }, { localStorage });
    expect(el.classList.contains('view-list')).toBe(true);
    localStorage.clear();
  });
});
