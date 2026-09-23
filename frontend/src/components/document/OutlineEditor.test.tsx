import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import type { OutlineChapter } from '../../lib/api/types/documents';
import { fakeApi } from '../review/testing/fakeApi';
import { OutlineEditor } from './OutlineEditor';

const guessed: OutlineChapter[] = [
  { title: 'Waiting', page_from: 1, page_to: 10, sections: [] },
  { title: 'Flow', page_from: 11, sections: [] },
];

function setup(routes: Parameters<typeof fakeApi>[0], needsReview = true) {
  const { api, calls } = fakeApi(routes);
  render(<OutlineEditor slug="meadows" initial={guessed} pageCount={20} hasOverride={false} needsReview={needsReview} api={api} />);
  return { calls, user: userEvent.setup() };
}

describe('<OutlineEditor>', () => {
  it('accepts a guessed outline unedited with one confirm call', async () => {
    const { calls, user } = setup({ 'POST documents/meadows/outline/confirm': () => ({ document: {}, jobs: [] }) });
    await user.click(screen.getByRole('button', { name: 'Outline looks right' }));
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', path: 'documents/meadows/outline/confirm', body: undefined }]));
    expect(screen.getByText(/Accepted\. The pipeline shows what it queued\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Outline looks right' })).toBeNull();
  });

  it('offers no confirm once the outline is edited, or when it is not waiting for review', async () => {
    const { user } = setup({});
    await user.type(screen.getByRole('textbox', { name: 'Chapter 1 title' }), '!');
    expect(screen.queryByRole('button', { name: 'Outline looks right' })).toBeNull();
  });

  it('says why a confirm was refused', async () => {
    const conflict = new ApiError({ status: 409, code: 'conflict', message: 'The outline is not waiting for review.' });
    const { user } = setup({ 'POST documents/meadows/outline/confirm': () => Promise.reject(conflict) });
    await user.click(screen.getByRole('button', { name: 'Outline looks right' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not waiting for review/);
  });

  it('saves a blank last page as an open-ended chapter and a skipped chapter as skip', async () => {
    const { calls, user } = setup({ 'PATCH documents/meadows/outline': () => ({ document: {}, job: {}, deduplicated: false }) }, false);
    await user.clear(screen.getByRole('spinbutton', { name: /Chapter 1 last page/ }));
    await user.click(screen.getByRole('checkbox', { name: /Skip chapter 2/ }));
    await user.click(screen.getByRole('button', { name: 'Save outline and re-parse' }));
    await waitFor(() =>
      expect(calls).toEqual([
        {
          method: 'PATCH',
          path: 'documents/meadows/outline',
          body: {
            chapters: [
              { title: 'Waiting', page_from: 1, sections: [] },
              { title: 'Flow', page_from: 11, skip: true, sections: [] },
            ],
          },
        },
      ]),
    );
  });
});
