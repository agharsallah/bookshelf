import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAutoHide } from './useReaderLayout';

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

afterEach(() => scrollTo(0));

describe('useAutoHide', () => {
  it('hides while scrolling down past the top, shows again on the way up', () => {
    const { result } = renderHook(() => useAutoHide(true, false));
    scrollTo(100);
    expect(result.current).toBe(false);
    scrollTo(400);
    expect(result.current).toBe(true);
    scrollTo(300);
    expect(result.current).toBe(false);
  });

  it('comes back when the pointer reaches the top edge', () => {
    const { result } = renderHook(() => useAutoHide(true, false));
    scrollTo(500);
    expect(result.current).toBe(true);
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientY: 20 }));
    });
    expect(result.current).toBe(false);
  });

  it('never hides when disabled or while something is pinned open', () => {
    const off = renderHook(() => useAutoHide(false, false));
    const pinned = renderHook(() => useAutoHide(true, true));
    scrollTo(600);
    expect([off.result.current, pinned.result.current]).toEqual([false, false]);
  });
});
