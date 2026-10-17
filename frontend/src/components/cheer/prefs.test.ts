// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapCheer, CHEER_CHANGE_EVENT, cheerBootstrapScript, cheerTone, readGoal, saveGoal, setCheerTone } from './prefs';

const host = (stored: string | null, dataset: DOMStringMap = {}) => ({
  localStorage: { getItem: () => stored },
  document: { documentElement: { dataset } },
});

afterEach(() => {
  delete document.documentElement.dataset.cheer;
  localStorage.clear();
});

describe('bootstrapCheer', () => {
  it('is quiet unless playful was chosen', () => {
    for (const [stored, tone] of [[null, 'quiet'], ['junk', 'quiet'], ['quiet', 'quiet'], ['playful', 'playful']] as const) {
      const h = host(stored);
      bootstrapCheer(h);
      expect(h.document.documentElement.dataset.cheer).toBe(tone);
    }
  });

  it('starts from the page default until a tone is chosen', () => {
    for (const [stored, tone] of [[null, 'playful'], ['junk', 'playful'], ['quiet', 'quiet'], ['playful', 'playful']] as const) {
      const h = host(stored, { cheerDefault: 'playful' });
      bootstrapCheer(h);
      expect(h.document.documentElement.dataset.cheer).toBe(tone);
    }
  });

  it('falls back to quiet when storage is blocked', () => {
    const h = { ...host(null), localStorage: { getItem: () => { throw new Error('blocked'); } } };
    bootstrapCheer(h);
    expect(h.document.documentElement.dataset.cheer).toBe('quiet');
  });

  it('serializes to a self-contained script', () => {
    localStorage.setItem('bookshelf:cheer', 'playful');
    new Function(cheerBootstrapScript)();
    expect(cheerTone()).toBe('playful');
  });
});

describe('setCheerTone', () => {
  it('applies, persists and announces the tone', () => {
    const heard = vi.fn();
    window.addEventListener(CHEER_CHANGE_EVENT, heard);
    setCheerTone('playful');
    expect([cheerTone(), localStorage.getItem('bookshelf:cheer')]).toEqual(['playful', 'playful']);
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener(CHEER_CHANGE_EVENT, heard);
  });
});

describe('the daily goal', () => {
  it('round-trips a known choice and refuses anything else', () => {
    expect(readGoal()).toBe(0);
    saveGoal(20);
    expect(readGoal()).toBe(20);
    localStorage.setItem('bookshelf:goal', '17');
    expect(readGoal()).toBe(0);
  });
});
