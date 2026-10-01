import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Atlas } from '../../lib/api/types/graph';
import { BookFilter, FIND_FROM } from './BookFilter';
import { shelf } from './fixtures';
import { DEFAULT_LENS, type LensState } from './lens';
import { indexAtlas } from './model';

/** A shelf of documents only: `papers` papers after `books` books, ids ending in their position. */
function documents(books: number, papers: number): Atlas {
  const template = shelf().nodes[0]!;
  const nodes = Array.from({ length: books + papers }, (_, i) => {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const genre = i < books ? ('book' as const) : ('paper' as const);
    const label = genre === 'book' ? `Book ${i}` : `Paper ${i}`;
    return { ...template, id: `document:${id}`, label, genre, document: { id, slug: `d${i}`, title: label } };
  });
  return { ...shelf(), nodes, edges: [] };
}

function setup(atlas: Atlas, initial: Partial<LensState> = {}) {
  const seen: (string[] | null)[] = [];
  function Harness() {
    const [lens, setLens] = useState<LensState>({ ...DEFAULT_LENS, mode: 'lens', ...initial });
    return (
      <BookFilter
        index={indexAtlas(atlas)}
        lens={lens}
        legend="Documents"
        onChange={(books) => {
          seen.push(books);
          setLens({ ...lens, books });
        }}
      />
    );
  }
  render(<Harness />);
  const group = within(screen.getByRole('group', { name: 'Documents' }));
  const ticked = () => group.queryAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).map((c) => c.closest('label')?.textContent);
  return { group, seen, ticked };
}

describe('<BookFilter>', () => {
  it('lists only the documents of the kinds the lens keeps', () => {
    const { group } = setup(documents(2, 3), { genres: ['book'] });
    expect(group.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)).toEqual(['Book 0', 'Book 1']);
    expect(group.getByText('2 of 2')).toBeTruthy();
  });

  it('"none" then one tick isolates a book, and "all" brings the list back to every book', async () => {
    const { group, seen, ticked } = setup(documents(3, 0));

    await userEvent.click(group.getByRole('button', { name: 'none' }));
    expect(ticked()).toEqual([]);
    expect(seen.at(-1)).toEqual([]);

    await userEvent.click(group.getByRole('checkbox', { name: 'Book 1' }));
    expect(ticked()).toEqual(['Book 1']);
    expect(group.getByText('1 of 3')).toBeTruthy();

    await userEvent.click(group.getByRole('button', { name: 'all' }));
    expect(seen.at(-1)).toBeNull();
  });

  it('"none" leaves the documents of a hidden kind as they were', async () => {
    const { group, seen } = setup(documents(2, 2), { genres: ['book'] });
    await userEvent.click(group.getByRole('button', { name: 'none' }));
    expect(seen.at(-1)).toEqual(['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']);
  });

  it('a long shelf can be narrowed by title, and "all" or "none" act on what is listed', async () => {
    const { group, seen, ticked } = setup(documents(FIND_FROM, 1));
    const find = group.getByRole('searchbox', { name: 'Find in documents' });

    await userEvent.type(find, 'paper');
    expect(group.getAllByRole('checkbox')).toHaveLength(1);
    await userEvent.click(group.getByRole('button', { name: 'none' }));
    expect(seen.at(-1)).toHaveLength(FIND_FROM);

    await userEvent.clear(find);
    expect(ticked()).toHaveLength(FIND_FROM);
    await userEvent.type(find, 'nothing like it');
    expect(group.getByText('No title matches.')).toBeTruthy();
  });

  it('"only" on a row keeps that document alone, leaving the documents of a hidden kind as they were', async () => {
    const { group, seen, ticked } = setup(documents(3, 1), { genres: ['book'] });
    await userEvent.click(group.getByRole('button', { name: 'Only Book 1' }));
    expect(ticked()).toEqual(['Book 1']);
    expect(seen.at(-1)).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003']);
  });

  it('"only these" keeps the titles that match and turns the rest of the list off', async () => {
    const { group, ticked } = setup(documents(FIND_FROM, 0));
    const find = group.getByRole('searchbox', { name: 'Find in documents' });
    expect(group.queryByRole('button', { name: 'only these' })).toBeNull();

    await userEvent.type(find, 'book 1');
    await userEvent.click(group.getByRole('button', { name: 'only these' }));
    await userEvent.type(find, '{Escape}');
    expect((find as HTMLInputElement).value).toBe('');
    expect(ticked()).toEqual(['Book 1']);
  });

  it('marks the match in each title', async () => {
    const { group } = setup(documents(FIND_FROM, 0));
    await userEvent.type(group.getByRole('searchbox', { name: 'Find in documents' }), 'ok 3');
    expect(group.getByText('ok 3').tagName).toBe('MARK');
  });

  it('a list mixing kinds has a section per kind, each with its own all and none', async () => {
    const { group, ticked } = setup(documents(2, 2));
    const papers = within(group.getByRole('region', { name: 'Papers' }));
    expect(papers.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)).toEqual(['Paper 2', 'Paper 3']);
    expect(within(group.getByRole('region', { name: 'Books' })).getAllByRole('checkbox')).toHaveLength(2);

    await userEvent.click(group.getByRole('button', { name: 'No papers' }));
    expect(ticked()).toEqual(['Book 0', 'Book 1']);
    expect(papers.getByText('0 of 2')).toBeTruthy();
    await userEvent.click(group.getByRole('button', { name: 'All papers' }));
    expect(ticked()).toHaveLength(4);
  });

  it('a list of one kind has no sections', () => {
    const { group } = setup(documents(2, 2), { genres: ['paper'] });
    expect(group.queryByRole('region')).toBeNull();
  });

  it('a short shelf has no box to find a book', () => {
    const { group } = setup(documents(FIND_FROM - 1, 0));
    expect(group.queryByRole('searchbox')).toBeNull();
  });
});
