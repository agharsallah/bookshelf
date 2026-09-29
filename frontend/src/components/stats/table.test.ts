import { describe, expect, it } from 'vitest';
import { ariaSort, nextSort, sortRows, type Column } from './table';

interface Row {
  name: string;
  size: number | null;
}

const columns: Column<Row>[] = [
  { key: 'name', label: 'Name', value: (r) => r.name },
  { key: 'size', label: 'Size', numeric: true, value: (r) => r.size },
  { key: 'note', label: 'Note' },
];

const rows: Row[] = [
  { name: 'Chapter 10', size: 3 },
  { name: 'chapter 2', size: null },
  { name: 'Chapter 1', size: 12 },
  { name: 'Appendix', size: 3 },
];

const names = (sorted: Row[]) => sorted.map((r) => r.name);

describe('sortRows', () => {
  it('orders figures either way and keeps missing values last in both', () => {
    expect(names(sortRows(rows, columns, { key: 'size', dir: 'desc' }))).toEqual(['Chapter 1', 'Chapter 10', 'Appendix', 'chapter 2']);
    expect(names(sortRows(rows, columns, { key: 'size', dir: 'asc' }))).toEqual(['Chapter 10', 'Appendix', 'Chapter 1', 'chapter 2']);
  });

  it('orders names naturally, ignoring case, so 2 comes before 10', () => {
    expect(names(sortRows(rows, columns, { key: 'name', dir: 'asc' }))).toEqual(['Appendix', 'Chapter 1', 'chapter 2', 'Chapter 10']);
  });

  it('leaves the rows as given when unsorted or the column cannot sort, without mutating them', () => {
    const before = [...rows];
    expect(sortRows(rows, columns, null)).toEqual(rows);
    expect(sortRows(rows, columns, { key: 'note', dir: 'asc' })).toEqual(rows);
    expect(rows).toEqual(before);
  });
});

describe('nextSort', () => {
  it('starts figures largest first and names from A, then flips on the same column', () => {
    expect(nextSort(null, columns[1]!)).toEqual({ key: 'size', dir: 'desc' });
    expect(nextSort({ key: 'size', dir: 'desc' }, columns[0]!)).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, columns[0]!)).toEqual({ key: 'name', dir: 'desc' });
  });

  it('lets a column choose its first direction', () => {
    expect(nextSort(null, { key: 'bar', label: 'Bar', firstDir: 'desc' })).toEqual({ key: 'bar', dir: 'desc' });
  });
});

describe('ariaSort', () => {
  it('names the direction only on the sorted column', () => {
    expect(ariaSort({ key: 'size', dir: 'desc' }, 'size')).toBe('descending');
    expect(ariaSort({ key: 'size', dir: 'asc' }, 'size')).toBe('ascending');
    expect(ariaSort({ key: 'size', dir: 'asc' }, 'name')).toBe('none');
    expect(ariaSort(null, 'size')).toBe('none');
  });
});
