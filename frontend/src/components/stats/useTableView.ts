/** A table's sort and how many of its rows are shown, over rows that never change. */
import { useState } from 'react';
import { nextSort, sortRows, type Column, type Sort } from './table';

export interface TableView<T> {
  sort: Sort | null;
  toggle: (column: Column<T>) => void;
  visible: T[];
  total: number;
  pageSize: number;
  more: () => void;
  all: () => void;
  fewer: () => void;
}

export function useTableView<T>(
  rows: readonly T[],
  columns: readonly Column<T>[],
  { initialSort = null, pageSize }: { initialSort?: Sort | null; pageSize: number },
): TableView<T> {
  const [sort, setSort] = useState<Sort | null>(initialSort);
  const [limit, setLimit] = useState(pageSize);
  const sorted = sortRows(rows, columns, sort); // tens of rows: cheaper than memoizing
  return {
    sort,
    toggle: (column) => setSort((current) => nextSort(current, column)),
    visible: sorted.slice(0, limit),
    total: sorted.length,
    pageSize,
    more: () => setLimit((n) => n + pageSize),
    all: () => setLimit(sorted.length),
    fewer: () => setLimit(pageSize),
  };
}
