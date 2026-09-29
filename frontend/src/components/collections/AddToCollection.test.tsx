import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { CollectionPublic } from '../../lib/api/types/collections';
import { ApiError } from '../../lib/api/errors';
import { fakeApi } from '../review/testing/fakeApi';
import { AddToCollection } from './AddToCollection';

const collection = (slug: string, name: string, ids: string[] = []): CollectionPublic => ({
  id: `id-${slug}`,
  slug,
  name,
  description: null,
  colour: null,
  document_ids: ids,
  created_at: '2026-09-29T00:00:00Z',
  updated_at: '2026-09-29T00:00:00Z',
});

describe('<AddToCollection>', () => {
  it('shows the collections holding the document and toggles membership', async () => {
    const { api, calls } = fakeApi({ 'PUT collections/rlhf/members/doc': () => ({}), 'DELETE collections/ft/members/doc': () => undefined });
    render(<AddToCollection documentId="doc" initial={[collection('ft', 'Fine-tuning', ['doc']), collection('rlhf', 'RLHF')]} api={api} />);

    expect(screen.getByRole('link', { name: 'Fine-tuning' }).getAttribute('href')).toBe('/collections/ft');
    await userEvent.click(screen.getByRole('button', { name: 'Collections…' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'RLHF' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fine-tuning' }));

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT collections/rlhf/members/doc', 'DELETE collections/ft/members/doc']);
    expect(screen.queryByRole('link', { name: 'Fine-tuning' })).toBeNull();
    expect(screen.getByRole('link', { name: 'RLHF' })).toBeTruthy();
  });

  it('unticks again when saving fails', async () => {
    const { api } = fakeApi({
      'PUT collections/ft/members/doc': () => Promise.reject(new ApiError({ status: 503, code: 'unavailable', message: 'Busy.' })),
    });
    render(<AddToCollection documentId="doc" initial={[collection('ft', 'Fine-tuning')]} api={api} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add to a collection' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fine-tuning' }));

    expect(await screen.findByText('Busy.')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Fine-tuning' }) as HTMLInputElement).checked).toBe(false);
  });

  it('stays out of the way when the collections cannot be loaded', async () => {
    const { api, calls } = fakeApi({
      'GET collections': () => Promise.reject(new ApiError({ status: 500, code: 'internal_error', message: 'An internal error occurred.' })),
    });
    const { container } = render(<AddToCollection documentId="doc" api={api} />);

    await waitFor(() => expect(calls).toHaveLength(1));
    await waitFor(() => expect(container.innerHTML).toBe(''));
    expect(screen.queryByText('An internal error occurred.')).toBeNull();
  });

  it('loads the collections when the page has none, and starts a new one with the document in it', async () => {
    const { api, calls } = fakeApi({
      'GET collections': () => [],
      'POST collections': () => collection('fine-tuning', 'Fine-tuning', ['doc']),
    });
    render(<AddToCollection documentId="doc" api={api} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add to a collection' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New collection' }), 'Fine-tuning');
    await userEvent.click(screen.getByRole('button', { name: 'Create with this' }));

    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: 'collections', body: { name: 'Fine-tuning', document_ids: ['doc'] } });
    expect(await screen.findByRole('link', { name: 'Fine-tuning' })).toBeTruthy();
  });
});
