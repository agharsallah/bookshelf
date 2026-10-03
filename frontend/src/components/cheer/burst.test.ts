// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { burst } from './burst';

const motion = (reduce: boolean) => vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: reduce } as MediaQueryList);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete document.documentElement.dataset.cheer;
  document.body.replaceChildren();
});

describe('burst', () => {
  it('stays still in the quiet tone and under reduced motion', () => {
    motion(false);
    expect(burst()).toBe(false);
    document.documentElement.dataset.cheer = 'playful';
    motion(true);
    expect(burst()).toBe(false);
    expect(document.body.children).toHaveLength(0);
  });

  it('runs in the quiet tone when forced, but never under reduced motion', () => {
    motion(false);
    expect(burst(window, () => 0.5, { force: true })).toBe(true);
    vi.restoreAllMocks();
    motion(true);
    expect(burst(window, () => 0.5, { force: true })).toBe(false);
  });

  it('drops hidden pieces in the playful tone and clears them after', () => {
    vi.useFakeTimers();
    motion(false);
    document.documentElement.dataset.cheer = 'playful';
    expect(burst(window, () => 0.5)).toBe(true);
    const layer = document.body.lastElementChild;
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect(layer?.children.length).toBeGreaterThan(10);
    vi.runAllTimers();
    expect(document.body.contains(layer)).toBe(false);
  });
});
