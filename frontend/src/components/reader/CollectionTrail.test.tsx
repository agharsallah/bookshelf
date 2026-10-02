import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../review/testing/fakeApi';
import { CollectionTrail, NextInCollection, type ReaderCollection } from './CollectionTrail';

const collection: ReaderCollection = {
  slug: 'ft',
  name: 'Fine-tuning',
  members: [
    { id: 'a', slug: 'lora', title: 'LoRA', genre: 'paper' },
    { id: 'b', slug: 'dl', title: 'Deep Learning', genre: 'book' },
  ],
};

describe('<CollectionTrail>', () => {
  it('names the collection, the place in it and its neighbours, keeping the collection in each link', () => {
    render(<CollectionTrail collection={collection} documentId="a" />);

    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fine-tuning' }).getAttribute('href')).toBe('/collections/ft');
    expect(screen.getByRole('link', { name: /Next in the collection: Deep Learning/ }).getAttribute('href')).toBe('/documents/dl/read?collection=ft');
  });

  it('shows nothing for a document outside the collection', () => {
    const { container } = render(<CollectionTrail collection={collection} documentId="z" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('<NextInCollection>', () => {
  it('offers the next document, and the way back after the last one', () => {
    const { rerender } = render(<NextInCollection collection={collection} documentId="a" />);
    expect(screen.getByRole('link').textContent).toBe('Next in Fine-tuning: Deep Learning');

    rerender(<NextInCollection collection={collection} documentId="b" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/collections/ft');
  });

  it('marks the document finished as you follow the link on', async () => {
    const { api, calls } = fakeApi({ 'PUT documents/a/reading/finished': () => ({}) });
    render(<NextInCollection collection={collection} documentId="a" api={api} />);
    const link = screen.getByRole('link');
    link.addEventListener('click', (e) => e.preventDefault()); // jsdom does not navigate

    await userEvent.click(link);

    expect(calls).toEqual([{ method: 'PUT', path: 'documents/a/reading/finished', body: undefined }]);
  });
});
