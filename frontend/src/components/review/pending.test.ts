import { describe, expect, it } from 'vitest';
import { createScheduler, type Timers } from './pending';

/** A hand-driven clock: `tick()` fires every timer that is still set. */
function manualTimers() {
  const live = new Map<number, () => void>();
  let next = 0;
  const timers: Timers = {
    set: (fn) => {
      next += 1;
      live.set(next, fn);
      return next;
    },
    clear: (handle) => live.delete(handle as number),
  };
  const tick = () => [...live.values()].forEach((fn) => fn());
  return { timers, tick };
}

describe('createScheduler', () => {
  it('sends an action only when its delay elapses', () => {
    const { timers, tick } = manualTimers();
    const sent: string[] = [];
    const scheduler = createScheduler(5000, timers);
    scheduler.schedule('a', () => sent.push('a'));
    expect(sent).toEqual([]);
    tick();
    expect(sent).toEqual(['a']);
    expect(scheduler.pending()).toBeNull();
  });

  it('undo drops the waiting action so it is never sent', () => {
    const { timers, tick } = manualTimers();
    const sent: string[] = [];
    const scheduler = createScheduler(5000, timers);
    scheduler.schedule('a', () => sent.push('a'));
    expect(scheduler.cancel('a')).toBe(true);
    tick();
    expect(sent).toEqual([]);
  });

  it('a new action sends the waiting one first, which can then no longer be undone', () => {
    const { timers } = manualTimers();
    const sent: string[] = [];
    const scheduler = createScheduler(5000, timers);
    scheduler.schedule('a', () => sent.push('a'));
    scheduler.schedule('b', () => sent.push('b'));
    expect(sent).toEqual(['a']);
    expect(scheduler.cancel('a')).toBe(false);
    expect(scheduler.pending()).toBe('b');
  });

  it('flush sends the waiting action now', () => {
    const { timers } = manualTimers();
    const sent: string[] = [];
    const scheduler = createScheduler(5000, timers);
    scheduler.schedule('a', () => sent.push('a'));
    scheduler.flush();
    expect(sent).toEqual(['a']);
  });

  it('with no delay, sends immediately', () => {
    const sent: string[] = [];
    createScheduler(0).schedule('a', () => sent.push('a'));
    expect(sent).toEqual(['a']);
  });
});
