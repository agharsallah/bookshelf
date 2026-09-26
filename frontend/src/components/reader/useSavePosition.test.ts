// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVE_DELAY_MS, useSavePosition } from './useSavePosition';

const api = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));

interface Props {
  active: string | null;
  progress: number;
}

function render(initial: Props) {
  return renderHook(({ active, progress }: Props) => useSavePosition('meadows', 'ch01', active, progress), {
    initialProps: initial,
  });
}

describe('useSavePosition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.put.mockReset().mockResolvedValue({});
  });
  afterEach(() => vi.useRealTimers());

  it('does not move your place when you only open the chapter', () => {
    const { unmount } = render({ active: 'ch01/p001', progress: 0.1 });
    act(() => vi.advanceTimersByTime(SAVE_DELAY_MS * 2));
    unmount();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('saves the latest block once reading settles', () => {
    const { rerender } = render({ active: 'ch01/p001', progress: 0.1 });
    rerender({ active: 'ch01/p002', progress: 0.2 });
    rerender({ active: 'ch01/p003', progress: 0.3 });
    expect(api.put).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(SAVE_DELAY_MS));

    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith(
      'documents/meadows/reading',
      { unit: 'ch01', anchor: 'ch01/p003', progress: 0.3 },
      { keepalive: false },
    );
  });

  it('saves what is pending when the page is left', () => {
    const { rerender } = render({ active: 'ch01/p001', progress: 0.1 });
    rerender({ active: 'ch01/p004', progress: 0.4 });

    act(() => void window.dispatchEvent(new Event('pagehide')));

    expect(api.put).toHaveBeenCalledWith('documents/meadows/reading', expect.objectContaining({ anchor: 'ch01/p004' }), {
      keepalive: true,
    });
  });

  it('finishes the chapter at the bottom of the page', () => {
    const { rerender } = render({ active: 'ch01/p001', progress: 0.1 });
    rerender({ active: 'ch01/p009', progress: 0.9 });
    Object.defineProperty(window, 'scrollY', { value: 10_000, configurable: true });

    act(() => void window.dispatchEvent(new Event('scroll')));
    act(() => vi.advanceTimersByTime(SAVE_DELAY_MS));

    expect(api.put).toHaveBeenLastCalledWith('documents/meadows/reading', expect.objectContaining({ progress: 1 }), {
      keepalive: false,
    });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});
