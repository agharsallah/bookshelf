/**
 * The one table every stats view draws: sortable column headers (a click sorts, a second
 * click flips) and the first `pageSize` rows with a way to show more. The first column is
 * the row header. Sorting and paging live in the browser; the server render shows the
 * default order's first page, so the page reads the same before it hydrates.
 */
import type { ReactNode } from 'react';
import { ariaSort, type Column, type Sort } from './table';
import { useTableView } from './useTableView';
import styles from './Stats.module.css';

export interface StatsColumn<T> extends Column<T> {
  cell: (row: T) => ReactNode;
  /** Extra classes on the cell (`num` is added for numeric columns). */
  cellClass?: (row: T) => string | undefined;
  cellTitle?: (row: T) => string | undefined;
}

interface Props<T> {
  rows: readonly T[];
  columns: readonly StatsColumn<T>[];
  rowKey: (row: T) => string;
  /** What a row is, plural, for the "Showing 10 of 40 books" line. */
  noun: string;
  label: string;
  initialSort?: Sort | null;
  pageSize?: number;
}

const ARROWS = { ascending: '↑', descending: '↓', none: '↕' } as const;

export function StatsTable<T>({ rows, columns, rowKey, noun, label, initialSort = null, pageSize = 15 }: Props<T>) {
  const view = useTableView(rows, columns, { initialSort, pageSize });
  const hidden = view.total - view.visible.length;
  return (
    <div className={styles.tableBlock}>
      <div className={styles.scroll}>
        <table className={styles.table} aria-label={label}>
          <thead>
            <tr>
              {columns.map((column) => {
                const sorted = ariaSort(view.sort, column.key);
                const className = column.numeric ? styles.num : undefined;
                if (!column.value) {
                  return (
                    <th key={column.key} scope="col" className={className} title={column.title}>
                      {column.label}
                    </th>
                  );
                }
                return (
                  <th key={column.key} scope="col" className={className} aria-sort={sorted === 'none' ? undefined : sorted}>
                    <button type="button" className={styles.sortButton} data-sorted={sorted !== 'none' || undefined} title={column.title} onClick={() => view.toggle(column)}>
                      {column.label}
                      <span className={styles.sortArrow} aria-hidden="true">
                        {ARROWS[sorted]}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.visible.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column, i) => {
                  const className = [column.numeric ? styles.num : '', column.cellClass?.(row) ?? ''].filter(Boolean).join(' ') || undefined;
                  const Cell = i === 0 ? 'th' : 'td';
                  return (
                    <Cell key={column.key} scope={i === 0 ? 'row' : undefined} className={className} title={column.cellTitle?.(row)}>
                      {column.cell(row)}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.total > view.pageSize ? (
        <p className={styles.pager}>
          <span>
            Showing {view.visible.length} of {view.total} {noun}
          </span>
          {hidden > 0 ? (
            <>
              <button type="button" onClick={view.more}>
                Show {Math.min(view.pageSize, hidden)} more
              </button>
              {hidden > view.pageSize ? (
                <button type="button" onClick={view.all}>
                  Show all
                </button>
              ) : null}
            </>
          ) : (
            <button type="button" onClick={view.fewer}>
              Show fewer
            </button>
          )}
        </p>
      ) : null}
    </div>
  );
}
