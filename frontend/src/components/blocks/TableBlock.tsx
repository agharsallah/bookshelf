import type { TableBlock as Table } from '../../lib/contract';
import { Spans } from './Spans';
import styles from './Table.module.css';

const NUMERIC = /^[\s$€£¥+−-]*\d[\d\s.,]*(%|[kKmMbB]|x|×)?$/;

/** True for figures that should align on the right in tabular numerals. */
export function isNumericCell(text: string): boolean {
  return NUMERIC.test(text.trim());
}

export function TableBlock({ block }: { block: Table }) {
  return (
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
                    <Spans spans={[cell]} />
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
