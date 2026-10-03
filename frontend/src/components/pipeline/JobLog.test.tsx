import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { JobPublic, ModelRunPublic } from '../../lib/api/types/jobs';
import { fakeApi } from '../review/testing/fakeApi';
import { JobLog } from './JobLog';

const failed: JobPublic = {
  id: 'f1', kind: 'derive', document_id: 'd1', anchor: 'ch03', skill: 'make-quiz', skill_version: '2', state: 'failed', attempts: 2,
  error: 'schema: <root>: bad', result: null, run_mode: 'batch', duration_ms: 64000, created_at: '2026-09-23T10:00:00Z',
  started_at: '2026-09-23T10:01:00Z', finished_at: '2026-09-23T10:02:04Z', payload: { params: { count: 5 } },
};

function call(overrides: Partial<ModelRunPublic>): ModelRunPublic {
  return {
    id: 'r1', attempt: 1, call: 1, skill: 'make-quiz', skill_version: '2', tier: 'distil', model: 'sonnet', ok: true, error: null,
    input_tokens: 12000, output_tokens: 800, cache_read_tokens: 9000, cache_write_tokens: null, cost_usd: 0.05, duration_ms: 30000,
    api_ms: 28000, turns: 3, prompt_chars: 40000, reply_chars: 3000, images: 0, created_at: '2026-09-23T10:01:00Z', ...overrides,
  };
}

describe('<JobLog>', () => {
  it('stays closed and loads nothing until opened', () => {
    const { calls, api } = fakeApi();
    render(<JobLog job={failed} api={api} />);
    expect(calls).toEqual([]);
    expect(screen.queryByRole('region', { name: 'Model calls' })).toBeNull();
  });

  it('opens onto every model call, its totals and the failing call’s error, and what the job was asked', async () => {
    const { api, calls } = fakeApi({
      'GET jobs/f1/runs': () => [call({}), call({ id: 'r2', attempt: 2, ok: false, error: 'reply was not JSON', cost_usd: 0.02 })],
    });
    render(<JobLog job={failed} api={api} />);

    await userEvent.click(screen.getByText('Log'));

    const log = await screen.findByRole('region', { name: 'Model calls' });
    await waitFor(() => expect(within(log).getByText(/2 calls/)).toBeTruthy());
    expect(within(log).getByText(/1 failed/)).toBeTruthy();
    expect(within(log).getByText(/25.6k tokens · \$0.07/)).toBeTruthy();
    expect(within(log).getByText('reply was not JSON')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Asked for' })).getByText(/"count": 5/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Error' })).getByText('schema: <root>: bad')).toBeTruthy();
    expect(calls).toEqual([{ method: 'GET', path: 'jobs/f1/runs', query: undefined }]);
  });

  it('says a queued job has made no call yet', async () => {
    const { api } = fakeApi({ 'GET jobs/q1/runs': () => [] });
    render(<JobLog job={{ ...failed, id: 'q1', state: 'queued', error: null, attempts: 0, queue_position: 3 }} api={api} />);

    await userEvent.click(screen.getByText('Log'));

    expect(await screen.findByText('None yet: the job has not run.')).toBeTruthy();
    expect(screen.getByText('3rd in line')).toBeTruthy();
  });
});
