import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import { fakeApi } from '../review/testing/fakeApi';
import { CollectionPath, type PathEntry, type ShelfEntry } from './CollectionPath';

const doc = (id: string, title: string, genre: ShelfEntry['genre'] = 'book'): ShelfEntry => ({ id, slug: id, title, authors: [], genre });
const entry = (d: ShelfEntry, share = 0): PathEntry => ({ ...d, share, progress: share >= 1 ? 'Finished' : 'Not started', resume: null, note: null });

const lora = doc('lora', 'LoRA', 'paper');
const book = doc('dl', 'Deep Learning');
const post = doc('post', 'A post', 'article');

const order = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('<CollectionPath>', () => {
  it('marks the first unfinished member as up next and links it into the reader with the collection', () => {
    render(<CollectionPath collection="ft" members={[entry(lora, 1), entry(book)]} shelf={[]} api={fakeApi().api} />);

    const next = screen.getByText('Up next').closest('li') as HTMLElement;
    expect(within(next).getByRole('link', { name: 'Deep Learning' }).getAttribute('href')).toBe('/documents/dl/read?collection=ft');
  });

  it('reorders, saving the whole new order', async () => {
    const { api, calls } = fakeApi({ 'PUT collections/ft/order': () => ({}) });
    render(<CollectionPath collection="ft" members={[entry(lora), entry(book)]} shelf={[]} api={api} />);

    await userEvent.click(screen.getByRole('button', { name: 'Move Deep Learning earlier' }));

    expect(order()).toEqual(['Deep Learning', 'LoRA']);
    expect(calls).toEqual([{ method: 'PUT', path: 'collections/ft/order', body: { document_ids: ['dl', 'lora'] } }]);
  });

  it('puts things back and says why when saving fails', async () => {
    const { api } = fakeApi({
      'DELETE collections/ft/members/lora': () => Promise.reject(new ApiError({ status: 503, code: 'unavailable', message: 'Busy.' })),
    });
    render(<CollectionPath collection="ft" members={[entry(lora), entry(book)]} shelf={[]} api={api} />);

    await userEvent.click(screen.getByRole('button', { name: 'Take LoRA out of the collection' }));

    expect(await screen.findByText('Busy.')).toBeTruthy();
    expect(order()).toEqual(['LoRA', 'Deep Learning']);
  });

  it('adds from the shelf by title, offering only what is not in it yet', async () => {
    const { api, calls } = fakeApi({ 'PUT collections/ft/members/post': () => ({}) });
    render(<CollectionPath collection="ft" members={[entry(lora)]} shelf={[lora, book, post]} api={api} />);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Add from your shelf' }), 'post');
    const matches = within(screen.getByRole('list', { name: 'Matching documents' }));
    expect(matches.getAllByRole('button').map((b) => b.textContent)).toEqual(['Article A post']);
    await userEvent.click(matches.getByRole('button'));

    expect(order()).toEqual(['LoRA', 'A post']);
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: 'collections/ft/members/post' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Add from your shelf' }), 'LoRA');
    expect(screen.getByText('Nothing else on the shelf matches “LoRA”.')).toBeTruthy();
  });

  it('saves a note, and an emptied note as none', async () => {
    const { api, calls } = fakeApi({ 'PUT collections/ft/members/lora': () => ({}) });
    render(<CollectionPath collection="ft" members={[entry(lora)]} shelf={[]} api={api} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Why LoRA is here' }), 'The adapter idea');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(screen.getByText('The adapter idea')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Why LoRA is here' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(calls.map((c) => c.body)).toEqual([{ note: 'The adapter idea' }, { note: null }]);
    expect(screen.getByRole('button', { name: 'Add a note' })).toBeTruthy();
  });
});
