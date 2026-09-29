/**
 * Sorting and paging for the stats tables, kept out of the components so it is testable
 * without a DOM. A column says how to read its sort value from a row; a missing value
 * (a `—` in the table) always sorts last, whichever way the column is ordered.
 */
export type SortDir = 'asc' | 'desc';

export interface Sort {
  key: string;
  dir: SortDir;
}

export type SortValue = number | string | null | undefined;

export interface Column<T> {
  key: string;
  label: string;
  /** Right-aligned figures; they sort largest first on the first click. */
  numeric?: boolean;
  /** The first click's direction when it is not the default (a bar column is a figure too). */
  firstDir?: SortDir;
  /** Absent: the column is not sortable. */
  value?: (row: T) => SortValue;
  /** Spelled out on hover, for terse headers. */
  title?: string;
}

const text = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return text.compare(String(a), String(b));
}

function missing(value: SortValue): boolean {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));
}

/** `rows` ordered by `sort` (stable; missing values last), or as given when unsorted. */
export function sortRows<T>(rows: readonly T[], columns: readonly Column<T>[], sort: Sort | null): T[] {
  const read = sort ? columns.find((c) => c.key === sort.key)?.value : undefined;
  if (!sort || !read) return [...rows];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      const ma = missing(a.value);
      const mb = missing(b.value);
      if (ma || mb) return ma === mb ? a.index - b.index : ma ? 1 : -1;
      return sign * compare(a.value, b.value) || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** What a click on `column`'s header does: flip the current column, else start it
 * at its natural direction (figures largest first, names A to Z). */
export function nextSort<T>(current: Sort | null, column: Column<T>): Sort {
  if (current?.key === column.key) return { key: column.key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key: column.key, dir: column.firstDir ?? (column.numeric ? 'desc' : 'asc') };
}

export function ariaSort(sort: Sort | null, key: string): 'ascending' | 'descending' | 'none' {
  if (sort?.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}
