/**
 * Formulas via KaTeX. Uses HTML pre-rendered by `prepareBlocks` when present;
 * otherwise shows the LaTeX source and, once hydrated, lazy-loads KaTeX.
 * `meaning` spans say in words what the formula states.
 */
import 'katex/dist/katex.min.css';
import { useEffect, useState } from 'react';
import type { PreparedMathBlock } from '../../lib/prepare';
import { BlockFigure } from './BlockFigure';
import { Spans } from './Spans';
import styles from './Math.module.css';

export function MathBlock({ block }: { block: PreparedMathBlock }) {
  const [html, setHtml] = useState<string | null>(block.html ?? null);

  useEffect(() => {
    if (block.html) return;
    let cancelled = false;
    import('../../lib/katex')
      .then(({ renderMath }) => renderMath(block.latex))
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        // The LaTeX source remains readable.
      });
    return () => {
      cancelled = true;
    };
  }, [block.html, block.latex]);

  return (
    <BlockFigure kind="math" cites={block.cites}>
      <div className={styles.formula}>
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code className={styles.source}>{block.latex}</code>
        )}
      </div>
      {block.meaning ? (
        <p className={styles.meaning}>
          <Spans spans={block.meaning} />
        </p>
      ) : null}
    </BlockFigure>
  );
}
