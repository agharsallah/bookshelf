// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from './toast';

const region = () => document.querySelector('[aria-live="polite"]');

beforeEach(() => {
  document.body.replaceChildren();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast', () => {
  // Screen readers only announce changes to a live region that already exists, so
  // the first message must arrive after the region, not together with it.
  it('creates the live region empty and writes the first message into it afterwards', () => {
    toast('Highlighted.');
    expect(region()?.textContent).toBe('');
    vi.advanceTimersByTime(150);
    expect(region()?.textContent).toBe('Highlighted.');
  });

  it('writes later messages at once and removes each after its lifetime', () => {
    toast('First.');
    vi.advanceTimersByTime(150);
    toast('Second.');
    expect(region()?.textContent).toBe('First.Second.');
    vi.advanceTimersByTime(5000);
    expect(region()?.textContent).toBe('');
  });

  it('dismisses early, even before the first message was written', () => {
    const dismiss = toast('Gone.');
    dismiss();
    vi.advanceTimersByTime(150);
    expect(region()?.textContent).toBe('');
  });
});
