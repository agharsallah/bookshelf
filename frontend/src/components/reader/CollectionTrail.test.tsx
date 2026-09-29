import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
