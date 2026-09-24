import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster, useToasts, type Toast } from './Toasts';

let push: (toast: Toast) => void = () => undefined;

function Harness() {
  const toasts = useToasts(3000);
  push = toasts.push;
  return <Toaster toasts={toasts.toasts} onDismiss={toasts.dismiss} onHold={toasts.hold} onRelease={toasts.release} />;
}

const shown = (text: string) => screen.queryByText(text) !== null;
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  render(<Harness />);
});

afterEach(() => {
  vi.useRealTimers();
});

// WCAG 2.2.1 (timing adjustable): an Undo must not vanish while someone is reaching for it.
describe('toasts with an Undo', () => {
  it('stay for at least ten seconds even with a shorter lifetime', () => {
    act(() => push({ id: 'a', message: 'Approved.', undo: vi.fn(), ttl: 3000 }));
    wait(9_900);
    expect(shown('Approved.')).toBe(true);
    wait(200);
    expect(shown('Approved.')).toBe(false);
  });

  it('do not dismiss while hovered, and restart their clock when the pointer leaves', () => {
    act(() => push({ id: 'a', message: 'Approved.', undo: vi.fn() }));
    fireEvent.mouseEnter(screen.getByText('Approved.'));
    wait(60_000);
    expect(shown('Approved.')).toBe(true);
    fireEvent.mouseLeave(screen.getByText('Approved.'));
    wait(9_900);
    expect(shown('Approved.')).toBe(true);
    wait(200);
    expect(shown('Approved.')).toBe(false);
  });

  it('do not dismiss while their Undo button has focus', () => {
    act(() => push({ id: 'a', message: 'Approved.', undo: vi.fn() }));
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    wait(60_000);
    expect(shown('Approved.')).toBe(true);
  });
});

describe('toasts without an Undo', () => {
  it('dismiss after their own lifetime', () => {
    act(() => push({ id: 'b', message: 'Saved.' }));
    wait(3_100);
    expect(shown('Saved.')).toBe(false);
  });
});
