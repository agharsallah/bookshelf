import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { StatsTable, type StatsColumn } from './StatsTable';

interface Row {
  name: string;
  size: number;
}

const columns: StatsColumn<Row>[] = [
  { key: 'name', label: 'Name', value: (r) => r.name, cell: (r) => r.name },
  { key: 'size', label: 'Size', numeric: true, value: (r) => r.size, cell: (r) => r.size },
  { key: 'note', label: 'Note', cell: () => '—' },
];

const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({ name: `Book ${i + 1}`, size: (i * 7) % 12 }));

const names = () => screen.getAllByRole('rowheader').map((th) => th.textContent);

function table(pageSize = 5) {
  render(<StatsTable rows={rows} columns={columns} rowKey={(r) => r.name} noun="books" label="Books" pageSize={pageSize} />);
}

describe('<StatsTable>', () => {
  it('sorts by a clicked header, largest first for figures, and flips on a second click', async () => {
    table(20);

    await userEvent.click(screen.getByRole('button', { name: /Size/ }));
    expect(screen.getByRole('columnheader', { name: /Size/ }).getAttribute('aria-sort')).toBe('descending');
    expect(names().slice(0, 2)).toEqual(['Book 6', 'Book 11']); // sizes 11, 10

    await userEvent.click(screen.getByRole('button', { name: /Size/ }));
    expect(names()[0]).toBe('Book 1'); // size 0
    expect(screen.getByRole('columnheader', { name: /Size/ }).getAttribute('aria-sort')).toBe('ascending');
  });

  it('keeps a column without a sort value as a plain header', () => {
    table();
    expect(within(screen.getByRole('columnheader', { name: 'Note' })).queryByRole('button')).toBeNull();
  });

  it('shows one page, then more, then all, then fewer again', async () => {
    table(5);
    expect(names()).toHaveLength(5);
    expect(screen.getByText('Showing 5 of 12 books')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(names()).toHaveLength(10);

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(names()).toHaveLength(12);

    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(names()).toHaveLength(5);
  });

  it('pages over the sorted rows, not the original order', async () => {
    table(3);
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));
    await userEvent.click(screen.getByRole('button', { name: /Name/ }));

    expect(names()).toEqual(['Book 12', 'Book 11', 'Book 10']); // natural order, Z to A
  });

  it('has no pager when every row fits', () => {
    table(20);
    expect(screen.queryByText(/Showing/)).toBeNull();
  });
});
