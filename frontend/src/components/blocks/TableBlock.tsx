import type { Anchor, Span, TableBlock as Table } from '../../lib/contract';
import { BlockSources } from './CiteChip';
import { Spans } from './Spans';
import styles from './Table.module.css';

const NUMERIC = /^[\s$€£¥+−-]*\d[\d\s.,]*(%|[kKmMbB]|x|×)?$/;

/** True for figures that should align on the right in tabular numerals. */
export function isNumericCell(text: string): boolean {
  return NUMERIC.test(text.trim());
}

const citeKey = (cell: Span): string => cell.cites.join('\u0000');

/**
 * Where a table's cites sit. A transcribed table cites its source on every cell, so a chip
 * per cell repeats one source dozens of times: cites shared by every cell are shown once
 * under the table, cites shared by a whole row once on its first cell, others per cell.
 */
export function tableCites(rows: readonly (readonly Span[])[]): { table: readonly Anchor[]; rows: ('row' | 'cells')[] } {
  const cells = rows.flat();
  const first = cells[0];
  if (first && first.cites.length > 0 && cells.every((c) => citeKey(c) === citeKey(first))) {
    return { table: first.cites, rows: rows.map(() => 'cells') };
  }
  const shared = ([head, ...rest]: readonly Span[]) => head !== undefined && rest.length > 0 && rest.every((c) => citeKey(c) === citeKey(head));
  return { table: [], rows: rows.map((row) => (shared(row) ? 'row' : 'cells')) };
}

export function TableBlock({ block }: { block: Table }) {
  const placed = tableCites(block.rows);
  const shown = (cell: Span, rowIndex: number, cellIndex: number): Span =>
    placed.table.length > 0 || (placed.rows[rowIndex] === 'row' && cellIndex > 0) ? { ...cell, cites: [] } : cell;
  return (
    <>
      <div
        className={styles.scroller}
        role="region"
        aria-label={block.caption ?? 'Table'}
        tabIndex={0}
      >
        <table className={styles.table}>
          {block.caption ? <caption className={styles.caption}>{block.caption}</caption> : null}
          <thead>
            <tr>
              {block.header.map((label, index) => (
                <th key={index} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => {
                  const Cell = cellIndex === 0 ? 'th' : 'td';
                  return (
                    <Cell
                      key={cellIndex}
                      scope={cellIndex === 0 ? 'row' : undefined}
                      data-numeric={isNumericCell(cell.text) || undefined}
                    >
                      <Spans spans={[shown(cell, rowIndex, cellIndex)]} />
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BlockSources anchors={placed.table} />
    </>
  );
}
