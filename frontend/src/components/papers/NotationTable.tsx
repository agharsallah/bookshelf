/**
 * The paper's notation as a two-column glossary: the symbol set in KaTeX, what it
 * stands for, where the paper first uses it (its section as the paper numbers it, a link that behaves like a cite: in the
 * tab it opens the passage in place, in the reader it jumps there) and its cites. A
 * search box filters by meaning or by the symbol typed loosely ("sigma", "g_i").
 *
 * Exported for the reader's notation side panel: give it symbols with `html` from
 * `prepareSymbols` (or without, and KaTeX loads lazily) inside a `CiteProvider`.
 */
import 'katex/dist/katex.min.css';
import { useEffect, useId, useState } from 'react';
import { anchorLabel } from '../../lib/anchors';
import { CiteMarks, SourceLink } from '../blocks/CiteChip';
import { useCite } from '../blocks/CiteContext';
import { filterSymbols, type PreparedSymbol } from './notation';
import styles from './Notation.module.css';

export interface NotationTableProps {
  symbols: PreparedSymbol[];
  /** Narrow layout for a side panel: meaning under the symbol, no cites column. */
  compact?: boolean;
  /** Hide the search box (a very short table). */
  searchable?: boolean;
}

/** Renders any symbol that came without HTML, once, in the browser. */
function useRendered(symbols: PreparedSymbol[]): PreparedSymbol[] {
  const [rendered, setRendered] = useState(symbols);
  useEffect(() => {
    setRendered(symbols);
    if (symbols.every((s) => s.html)) return;
    let cancelled = false;
    import('../../lib/katex')
      .then(({ renderInlineMath }) => Promise.all(symbols.map(async (s) => ({ ...s, html: s.html ?? (await renderInlineMath(s.latex)) }))))
      .then((out) => {
        if (!cancelled) setRendered(out);
      })
      .catch(() => {
        // The LaTeX source stays readable.
      });
    return () => {
      cancelled = true;
    };
  }, [symbols]);
  return rendered;
}

export function NotationTable({ symbols, compact = false, searchable = true }: NotationTableProps) {
  const label = useCite().citeLabel ?? anchorLabel;
  const [query, setQuery] = useState('');
  const id = useId();
  const shown = filterSymbols(useRendered(symbols), query);

  return (
    <div className={styles.notation} data-compact={compact || undefined}>
      {searchable ? (
        <div className={styles.search}>
          <label htmlFor={id}>Find a symbol</label>
          <input id={id} type="search" value={query} placeholder="By meaning or name, e.g. gate, sigma" onChange={(e) => setQuery(e.target.value)} />
          <span className={styles.count} aria-live="polite">
            {query ? `${shown.length} of ${symbols.length}` : `${symbols.length} symbols`}
          </span>
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className={styles.none}>No symbol matches “{query}”.</p>
      ) : (
        <dl className={styles.list}>
          {shown.map((s) => (
            <div key={`${s.latex}|${s.firstAnchor ?? ''}`} className={styles.row}>
              <dt className={styles.symbol}>{s.html ? <span dangerouslySetInnerHTML={{ __html: s.html }} /> : <code>{s.latex}</code>}</dt>
              <dd className={styles.meaning}>
                <span>{s.meaning}</span>
                <span className={styles.where}>
                  {s.firstAnchor ? (
                    <SourceLink anchor={s.firstAnchor} className={styles.first}>
                      {s.firstPlace ? `First used in ${s.firstPlace}` : `First used at ${label(s.firstAnchor)}`}
                    </SourceLink>
                  ) : null}
                  {!compact ? <CiteMarks anchors={s.cites.filter((c) => c !== s.firstAnchor)} /> : null}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default NotationTable;
