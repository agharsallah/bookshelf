import { describe, expect, it } from 'vitest';
import { ActivityLog, MINUTE_MS } from './log';

const T = Date.UTC(2026, 8, 28, 9, 14, 0);
const read = { surface: 'read' as const, document: 'book', unit: 'ch01', anchor: 'ch01/p001' };

describe('ActivityLog', () => {
  it('adds seconds per minute and place, capped at a minute', () => {
    const log = new ActivityLog();
    log.add(read, 40, T);
    log.add(read, 40, T + 10_000);
    log.add({ ...read, anchor: 'ch01/p002' }, 5, T);

    expect(log.drain(T + MINUTE_MS)).toEqual([
      { ...read, at: '2026-09-28T09:14:00.000Z', seconds: 60 },
      { ...read, anchor: 'ch01/p002', at: '2026-09-28T09:14:00.000Z', seconds: 5 },
    ]);
    expect(log.size).toBe(0);
  });

  it('keeps the fraction of the current minute for the next report', () => {
    const log = new ActivityLog();
    log.add(read, 2.6, T);

    expect(log.drain(T + 1000).map((e) => e.seconds)).toEqual([2]);
    log.add(read, 0.6, T + 2000);
    expect(log.drain(T + MINUTE_MS).map((e) => e.seconds)).toEqual([1]);
  });

  it('leaves out the fields a place does not have', () => {
    const log = new ActivityLog();
    log.add({ surface: 'explore', detail: 'search' }, 5, T);

    expect(log.drain(T + MINUTE_MS)).toEqual([{ surface: 'explore', detail: 'search', at: '2026-09-28T09:14:00.000Z', seconds: 5 }]);
  });

  it('takes back entries that could not be sent', () => {
    const log = new ActivityLog();
    log.add(read, 30, T);
    const entries = log.drain(T + MINUTE_MS);

    log.restore(entries);

    expect(log.drain(T + MINUTE_MS)).toEqual(entries);
  });

  it('ignores nothing and negative time', () => {
    const log = new ActivityLog();
    log.add(read, 0, T);
    log.add(read, -3, T);

    expect(log.size).toBe(0);
  });
});
