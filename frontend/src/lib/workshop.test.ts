// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapWorkshop, isWorkshop, setWorkshop, WORKSHOP_CHANGE_EVENT, workshopBootstrapScript } from './workshop';

const host = (stored: string | null) => ({
  localStorage: { getItem: () => stored },
  document: { documentElement: { dataset: {} as DOMStringMap } },
});

afterEach(() => {
  delete document.documentElement.dataset.workshop;
  localStorage.clear();
});

describe('bootstrapWorkshop', () => {
  it('starts in reading mode unless workshop was switched on', () => {
    for (const [stored, on] of [[null, false], ['off', false], ['junk', false], ['on', true]] as const) {
      const h = host(stored);
      bootstrapWorkshop(h);
      expect('workshop' in h.document.documentElement.dataset).toBe(on);
    }
  });

  it('falls back to reading mode when storage is blocked', () => {
    const h = { ...host(null), localStorage: { getItem: () => { throw new Error('blocked'); } } };
    expect(() => bootstrapWorkshop(h)).not.toThrow();
    expect('workshop' in h.document.documentElement.dataset).toBe(false);
  });

  it('serializes to a self-contained script', () => {
    localStorage.setItem('bookshelf:workshop', 'on');
    new Function(workshopBootstrapScript)();
    expect(isWorkshop()).toBe(true);
  });
});

describe('setWorkshop', () => {
  it('applies, persists and announces the mode', () => {
    const heard = vi.fn();
    window.addEventListener(WORKSHOP_CHANGE_EVENT, heard);
    setWorkshop(true);
    expect([isWorkshop(), localStorage.getItem('bookshelf:workshop')]).toEqual([true, 'on']);
    setWorkshop(false);
    expect([isWorkshop(), localStorage.getItem('bookshelf:workshop')]).toEqual([false, 'off']);
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener(WORKSHOP_CHANGE_EVENT, heard);
  });
});
