import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobPublic, RunLogEvent } from '../../lib/api/types/jobs';
import { fakeApi } from '../review/testing/fakeApi';
import { POLL_MS, RunLogView } from './RunLogView';

const running: JobPublic = {
  id: 'r1', kind: 'distil_section', document_id: 'd1', anchor: 'ch01/s01', skill: 'distil-section', skill_version: '3', state: 'running', attempts: 1,
  error: null, result: null, run_mode: 'batch', duration_ms: null, created_at: '2026-10-03T19:00:00Z', started_at: '2026-10-03T19:05:00Z', finished_at: null,
};
const ev = (type: string, fields: Record<string, unknown> = {}): RunLogEvent => ({ at: '2026-10-03T19:05:17Z', attempt: 1, type, ...fields });

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('<RunLogView>', () => {
  it('follows a running job, asking only for what came since its last read', async () => {
    const pages = [
      { events: [ev('started'), ev('call', { call: 1, tier: 'distil', prompt: 'Distil this section.', prompt_chars: 20 }), ev('text', { text: '{"body": ' })], next: 120 },
      { events: [ev('text', { text: '[]}' })], next: 160 },
    ];
    const { api, calls } = fakeApi({ 'GET jobs/r1/log': () => pages.shift() ?? { events: [], next: 160 } });
    render(<RunLogView job={running} api={api} />);

    const log = await screen.findByRole('region', { name: 'Run log' });
    expect(await within(log).findByText('{"body":')).toBeTruthy();
    expect(within(log).getByText('following live')).toBeTruthy();
    expect(within(log).getByText('Prompt · 20 characters')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });

    expect(await within(log).findByText('{"body": []}')).toBeTruthy();
    expect(calls.map((c) => c.query)).toEqual([{ after: 0 }, { after: 120 }, ...calls.slice(2).map(() => ({ after: 160 }))]);
  });

  it('reads a finished job once and stops', async () => {
    const { api, calls } = fakeApi({ 'GET jobs/r1/log': () => ({ events: [ev('reply', { ok: true, text: '{"ok": true}', model: 'sonnet' }), ev('finished', { state: 'done' })], next: 90 }) });
    render(<RunLogView job={{ ...running, state: 'done' }} api={api} />);

    expect(await screen.findByText('{"ok": true}')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(calls).toHaveLength(1);
  });
});
