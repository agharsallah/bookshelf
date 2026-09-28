/**
 * The results tab's view model (pure): one paper's `results_table` rows pivoted into a
 * method × (dataset, metric) matrix (one table per benchmark family), the best
 * value per column, and the rows of one bar chart per column.
 *
 * Best follows `papers/compare.py` for a single paper: the column's direction is the
 * majority of its rows' `higher_is_better`, its unit the most common one, only cells in
 * that unit are comparable, and a best is marked once at least two are.
 */
import type { BarRow } from '../charts/HBars';
import type { ResultRow } from './extract-bodies';

export interface ResultColumn {
  /** `<dataset>|<metric>`. */
  key: string;
  dataset: string;
  metric: string;
  unit: string | null;
  higherIsBetter: boolean;
  rows: ResultRow[];
  /** The best comparable value, or null with fewer than two comparable cells. */
  best: number | null;
}

export interface MatrixRow {
  /** `<method>|<setting>`. */
  key: string;
  method: string;
  setting: string | null;
  isProposed: boolean;
  /** Column key → the row reported there. */
  cells: Record<string, ResultRow>;
}

export interface ResultMatrix {
  columns: ResultColumn[];
  rows: MatrixRow[];
}

const columnKey = (r: Pick<ResultRow, 'dataset' | 'metric'>) => `${r.dataset}|${r.metric}`;
const rowKey = (r: Pick<ResultRow, 'method' | 'setting'>) => `${r.method}|${r.setting ?? ''}`;

function mostCommon<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let most = 0;
  for (const [v, n] of counts) {
    if (n > most) [best, most] = [v, n];
  }
  return best;
}

/** Whether a row counts toward its column's best (same unit as the column). */
export function comparable(column: Pick<ResultColumn, 'unit'>, row: Pick<ResultRow, 'unit'>): boolean {
  return row.unit === column.unit;
}

export function isBest(column: Pick<ResultColumn, 'best' | 'unit'>, row: Pick<ResultRow, 'value' | 'unit'>): boolean {
  return column.best !== null && comparable(column, row) && row.value === column.best;
}

/** Columns in order of first appearance, each with its direction, unit and best. */
export function resultColumns(rows: readonly ResultRow[]): ResultColumn[] {
  const groups = new Map<string, ResultRow[]>();
  for (const row of rows) groups.set(columnKey(row), [...(groups.get(columnKey(row)) ?? []), row]);
  return [...groups.entries()].map(([key, members]) => {
    const up = members.filter((r) => r.higherIsBetter).length;
    const higherIsBetter = up * 2 >= members.length;
    const unit = mostCommon(members.map((r) => r.unit)) ?? null;
    const values = members.filter((r) => r.unit === unit).map((r) => r.value);
    const best = values.length >= 2 ? (higherIsBetter ? Math.max(...values) : Math.min(...values)) : null;
    const first = members[0] as ResultRow;
    return { key, dataset: first.dataset, metric: first.metric, unit, higherIsBetter, rows: members, best };
  });
}

/** The matrix: proposed methods first, then the rest, each in order of first appearance. */
export function resultMatrix(rows: readonly ResultRow[]): ResultMatrix {
  const byMethod = new Map<string, MatrixRow>();
  for (const row of rows) {
    const key = rowKey(row);
    const entry = byMethod.get(key) ?? { key, method: row.method, setting: row.setting, isProposed: false, cells: {} };
    entry.isProposed ||= row.isProposed;
    entry.cells[columnKey(row)] ??= row;
    byMethod.set(key, entry);
  }
  const all = [...byMethod.values()];
  return { columns: resultColumns(rows), rows: [...all.filter((r) => r.isProposed), ...all.filter((r) => !r.isProposed)] };
}

/** A dataset's benchmark family: its first word ("GLUE MNLI-m" → "GLUE", "SQuAD v1.1 Dev"
 * → "SQuAD"), case-insensitive. */
export function benchmarkFamily(dataset: string): string {
  return (dataset.trim().split(/\s+/)[0] ?? '').toLowerCase();
}

/**
 * The matrix split into one table per benchmark family, each with only the rows that
 * report on it. A paper that reports GLUE, SQuAD and SWAG gets three dense tables instead
 * of one mostly blank one; a system reported on two families appears in both. Families
 * come in the order of their first column, rows and columns in the matrix's order.
 */
export function matrixParts(matrix: ResultMatrix): ResultMatrix[] {
  const families = new Map<string, ResultColumn[]>();
  for (const column of matrix.columns) {
    const family = benchmarkFamily(column.dataset);
    families.set(family, [...(families.get(family) ?? []), column]);
  }
  return [...families.values()].map((columns) => ({
    columns,
    rows: matrix.rows.filter((row) => columns.some((c) => c.key in row.cells)),
  }));
}

/** Datasets with their columns, for a two-level table header. */
export function datasetGroups(columns: readonly ResultColumn[]): { dataset: string; columns: ResultColumn[] }[] {
  const groups: { dataset: string; columns: ResultColumn[] }[] = [];
  for (const column of columns) {
    const group = groups.find((g) => g.dataset === column.dataset);
    if (group) group.columns.push(column);
    else groups.push({ dataset: column.dataset, columns: [column] });
  }
  return groups;
}

export const PROPOSED_SERIES = { key: 'proposed', label: 'This paper’s method', color: 'var(--series-1)' } as const;
export const OTHER_SERIES = { key: 'other', label: 'Baselines and others', color: 'var(--series-other)' } as const;

/** One column's bars: best first in the column's direction; the proposed method in its own series. */
export function columnBars(column: ResultColumn): BarRow[] {
  return column.rows
    .filter((r) => comparable(column, r))
    .sort((a, b) => (column.higherIsBetter ? b.value - a.value : a.value - b.value))
    .map((r) => ({
      key: rowKey(r),
      label: r.method,
      ...(r.setting ? { sub: r.setting } : {}),
      values: { [r.isProposed ? PROPOSED_SERIES.key : OTHER_SERIES.key]: Math.abs(r.value) },
      valueLabel: `${formatValue(r.value, null)}${isBest(column, r) ? ' best' : ''}`,
    }));
}

/** Columns worth a chart: at least two comparable values. */
export function chartColumns(columns: readonly ResultColumn[]): ResultColumn[] {
  return columns.filter((c) => c.rows.filter((r) => comparable(c, r)).length >= 2);
}

const SUPERSCRIPT: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** `28.4`, `4.92 %`, `2.3 × 10¹⁹ FLOPs`: at most four significant digits. */
export function formatValue(value: number, unit: string | null): string {
  const magnitude = Math.abs(value);
  let text: string;
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)) {
    const [mantissa = '', exponent = ''] = value.toExponential(2).split('e');
    const digits = exponent.replace('+', '').replace(/./g, (c) => SUPERSCRIPT[c] ?? c);
    text = `${String(Number(mantissa))} × 10${digits}`;
  } else {
    text = value.toLocaleString('en-GB', { maximumSignificantDigits: 4 });
  }
  return unit ? `${text} ${unit}` : text;
}

/** `/papers/compare?ids=a,b`: this paper and the ones picked. */
export function compareHref(ids: readonly string[]): string {
  return `/papers/compare?ids=${ids.map(encodeURIComponent).join(',')}`;
}
