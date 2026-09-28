// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { BEFORE_SWAP, onPage, PAGE_LOAD } from './page';

describe('onPage', () => {
  it('runs on every page shown, and drops the last page’s listeners when it is swapped out', () => {
    const heard = vi.fn();
    const setup = vi.fn((signal: AbortSignal) => window.addEventListener('ping', heard, { signal }));
    onPage(setup);

    document.dispatchEvent(new Event(PAGE_LOAD));
    window.dispatchEvent(new Event('ping'));
    expect(heard).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event(BEFORE_SWAP));
    window.dispatchEvent(new Event('ping'));
    expect(heard).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event(PAGE_LOAD));
    window.dispatchEvent(new Event('ping'));
    expect(setup).toHaveBeenCalledTimes(2);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
