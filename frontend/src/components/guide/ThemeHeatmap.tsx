/**
 * Where the author returns to each theme: a theme × chapter table whose cells are shaded
 * by how many passages the theme cites in that chapter (one hue, light → dark). It is a
 * real table, so screen readers get rows and columns; each filled cell links to the
 * first passage it counts. Below it, each theme as the guide states it.
 */
import type { Anchor } from '../../lib/contract';
import { CiteProvider } from '../blocks/CiteContext';
import { Spans } from '../blocks/Spans';
import { HEAT_LEVELS, themeMatrix, type ChapterRow, type Theme } from './guide';
import styles from './Guide.module.css';

const passages = (n: number) => `${n} passage${n === 1 ? '' : 's'}`;

export interface ThemeHeatmapProps {
  themes: readonly Theme[];
  rows: readonly ChapterRow[];
  citeHref: (anchor: Anchor) => string;
}

export function ThemeHeatmap({ themes, rows, citeHref }: ThemeHeatmapProps) {
  const matrix = themeMatrix(themes, rows);
  const lastThird = Math.floor((rows.length * 2) / 3);
  return (
    <CiteProvider value={{ citeHref }}>
      <div className={styles.heatScroll}>
        <table className={styles.heat}>
          <caption className="visually-hidden">Passages citing each theme, by chapter</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.heatCorner}>
                Theme
              </th>
              {rows.map((row) => (
                <th key={row.anchor} scope="col" className={styles.heatCol}>
                  <abbr title={row.heading}>{row.number}</abbr>
                </th>
              ))}
              <th scope="col" className={styles.heatReach}>
                Chapters
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((theme) => (
              <tr key={theme.name}>
                <th scope="row" className={styles.heatName}>
                  {theme.name}
                </th>
                {theme.cells.map((cell, i) => {
                  const row = rows[i];
                  if (!row) return null;
                  const where = `chapter ${row.number}, ${row.heading}`;
                  return (
                    <td key={row.anchor}>
                      {cell.first ? (
                        <a
                          className={styles.cell}
                          href={citeHref(cell.first)}
                          data-level={cell.level}
                          data-align={i >= lastThird ? 'end' : 'start'}
                          data-tip={`${row.number}. ${row.heading} · ${passages(cell.count)}`}
                          aria-label={`${theme.name} in ${where}: ${passages(cell.count)}`}
                        />
                      ) : (
                        <span className={styles.cell} data-level="0" role="img" aria-label={`Not in ${where}`} />
                      )}
                    </td>
                  );
                })}
                <td className={styles.heatReach}>{theme.reach}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.heatKey} aria-hidden="true">
        <span>Fewer passages</span>
        {Array.from({ length: HEAT_LEVELS }, (_, i) => (
          <span key={i} className={styles.cell} data-level={i + 1} />
        ))}
        <span>More</span>
      </p>

      <dl className={styles.themes}>
        {themes.map((theme) => (
          <div key={theme.name}>
            <dt>{theme.name}</dt>
            <dd>
              <Spans spans={theme.spans} />
            </dd>
          </div>
        ))}
      </dl>
    </CiteProvider>
  );
}

export default ThemeHeatmap;
