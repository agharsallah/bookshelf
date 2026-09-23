import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import { fakeApi } from '../review/testing/fakeApi';
import { PausedNotice } from './PausedNotice';

const paused = { reason: '400 skill runs reached the ceiling of 400', at: '2026-09-23T10:00:00Z', runs: 400, limit: 400 };

describe('<PausedNotice>', () => {
  it('resumes the document and confirms how many jobs were requeued', async () => {
    const { api, calls } = fakeApi({ 'POST documents/meadows/resume': () => ({ document: {}, requeued: [{}, {}] }) });
    render(<PausedNotice documentRef="meadows" paused={paused} api={api} />);
    expect(screen.getByRole('region', { name: 'Paused' }).textContent).toMatch(/400 skill runs reached the ceiling of 400\./);
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect((await screen.findByRole('status')).textContent).toBe('Resumed. 2 stopped jobs are queued again.');
    expect(calls).toEqual([{ method: 'POST', path: 'documents/meadows/resume', body: {} }]);
  });

  it('keeps the notice and says why when the resume fails', async () => {
    const down = new ApiError({ status: 0, code: 'network_error', message: 'The API could not be reached.' });
    const { api } = fakeApi({ 'POST documents/meadows/resume': () => Promise.reject(down) });
    render(<PausedNotice documentRef="meadows" paused={paused} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/The document was not resumed/);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });
});
