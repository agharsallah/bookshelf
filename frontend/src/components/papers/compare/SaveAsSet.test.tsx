import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { fakeApi } from '../../review/testing/fakeApi';
import { SaveAsSet } from './SaveAsSet';

describe('<SaveAsSet>', () => {
  it('saves the set once: a retry after a failed synthesis only queues the synthesis', async () => {
    let fail = true;
    const { api, calls } = fakeApi({
      'POST paper-sets': () => ({ id: 's1' }),
      'POST paper-sets/s1/synthesis': () =>
        fail ? Promise.reject(new ApiError({ status: 503, code: 'unavailable', message: 'Busy.' })) : { id: 'j1' },
    });
    const go = vi.fn();
    render(<SaveAsSet documentIds={['a', 'b']} defaultName="A vs B" api={api} go={go} />);
    const button = screen.getByRole('button', { name: 'Save as set and synthesize' });

    await userEvent.click(button);
    expect(await screen.findByText('Busy.')).toBeTruthy();
    fail = false;
    await userEvent.click(button);

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST paper-sets', 'POST paper-sets/s1/synthesis', 'POST paper-sets/s1/synthesis']);
    expect(go).toHaveBeenCalledWith('/papers/sets/s1');
  });
});
