/**
 * The results tab as one island: the paper's reported numbers as method × (dataset,
 * metric) tables, one per group of systems and benchmarks that share cells — the paper's own method first and marked, the best value per column in
 * bold, arrows for the metric's direction, units in the header, a cite on every cell —
 * then one bar chart per column with at least two comparable values.
 */
import { CiteProvider } from '../blocks/CiteContext';
import { CiteMarks } from '../blocks/CiteChip';
import { HBars } from '../charts/HBars';
import type { PassageUnit } from '../guide/passage';
import type { ResultRow } from './extract-bodies';
import { chartColumns, columnBars, datasetGroups, formatValue, isBest, matrixParts, OTHER_SERIES, PROPOSED_SERIES, resultMatrix, type ResultColumn, type ResultMatrix } from './results';
import { useCitedPassages } from './useCitedPassages';
import styles from './Results.module.css';

export interface ResultsBodyProps {
  slug: string;
  rows: ResultRow[];
  units: PassageUnit[];
}

const direction = (c: Pick<ResultColumn, 'higherIsBetter'>) => (c.higherIsBetter ? 'higher is better' : 'lower is better');

function ColumnHead({ column }: { column: ResultColumn }) {
  return (
    <th scope="col" title={direction(column)}>
      {column.metric}
      <span className={styles.arrow} aria-label={direction(column)}>
        {column.higherIsBetter ? '↑' : '↓'}
      </span>
      {column.unit ? <span className={styles.unit}>{column.unit}</span> : null}
    </th>
  );
}

/** One part of the matrix: a method × (dataset, metric) table with a two-level header. */
function ResultTable({ part, label }: { part: ResultMatrix; label: string }) {
  const groups = datasetGroups(part.columns);
  const columns = groups.flatMap((g) => g.columns);
  return (
    <div className={styles.scroll} tabIndex={0} role="region" aria-label={label}>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th rowSpan={2} scope="col" className={styles.methodHead}>
              Method
            </th>
            {groups.map((g) => (
              <th key={g.dataset} colSpan={g.columns.length} scope="colgroup" className={styles.dataset}>
                {g.dataset || 'Dataset not named'}
              </th>
            ))}
          </tr>
          <tr>
            {columns.map((c) => (
              <ColumnHead key={c.key} column={c} />
            ))}
          </tr>
        </thead>
        <tbody>
          {part.rows.map((row) => (
            <tr key={row.key} data-proposed={row.isProposed || undefined}>
              <th scope="row" className={styles.method}>
                {row.method}
                {row.isProposed ? <span className={styles.ours}>this paper</span> : null}
                {row.setting ? <span className={styles.setting}>{row.setting}</span> : null}
              </th>
              {columns.map((c) => {
                const cell = row.cells[c.key];
                if (!cell) return <td key={c.key} className={styles.blank} aria-label="not reported" />;
                const best = isBest(c, cell);
                return (
                  <td key={c.key} data-best={best || undefined}>
                    <span className={styles.value}>{formatValue(cell.value, cell.unit === c.unit ? null : cell.unit)}</span>
                    {best ? <span className="visually-hidden"> (best)</span> : null}
                    <CiteMarks anchors={cell.cites} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A part's name: its family as the paper writes it ("GLUE", "SQuAD"). */
const partName = (part: ResultMatrix) => part.columns[0]?.dataset.trim().split(/\s+/)[0] || 'Unnamed dataset';

export function ResultsBody({ slug, rows, units }: ResultsBodyProps) {
  const { cite, overlays } = useCitedPassages(slug, units, 'From the results');
  const matrix = resultMatrix(rows);
  const parts = matrixParts(matrix);
  const charts = chartColumns(matrix.columns);

  return (
    <CiteProvider value={cite}>
      <section className={styles.part} aria-labelledby="results-table">
        <h2 id="results-table">Reported results</h2>
        {parts.length === 1 && parts[0] ? (
          <ResultTable part={parts[0]} label="Reported results" />
        ) : (
          parts.map((part) => (
            <div key={part.columns[0]?.key ?? 'empty'} className={styles.family}>
              <h3>{partName(part)}</h3>
              <ResultTable part={part} label={`Results on ${partName(part)}`} />
            </div>
          ))
        )}
      </section>

      {charts.length > 0 ? (
        <section className={styles.part} aria-labelledby="results-charts">
          <h2 id="results-charts">Side by side</h2>
          <div className={styles.charts}>
            {charts.map((c) => (
              <div key={c.key} className={styles.chart}>
                <h3>
                  {c.metric} on {c.dataset}
                  <span className={styles.chartNote}>
                    {c.unit ? `${c.unit}, ` : ''}
                    {direction(c)}
                  </span>
                </h3>
                <HBars rows={columnBars(c)} series={[PROPOSED_SERIES, OTHER_SERIES]} format={(v) => formatValue(v, null)} label={`${c.metric} on ${c.dataset}`} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {overlays}
    </CiteProvider>
  );
}

export default ResultsBody;
