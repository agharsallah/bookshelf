/**
 * Verbatim listings. Uses HTML pre-highlighted by `prepareBlocks` when present;
 * otherwise renders a plain <pre> and, once hydrated, lazy-loads Shiki's
 * fine-grained core to highlight in place.
 */
import { useEffect, useState } from 'react';
import type { PreparedCodeBlock } from '../../lib/prepare';
import { BlockFigure } from './BlockFigure';
import styles from './Code.module.css';

export function CodeBlock({ block }: { block: PreparedCodeBlock }) {
  const [html, setHtml] = useState<string | null>(block.html ?? null);

  useEffect(() => {
    if (block.html) return;
    let cancelled = false;
    import('../../lib/highlight')
      .then(({ highlightCode }) => highlightCode(block.text, block.language))
      .then((out) => {
        if (!cancelled && out) setHtml(out);
      })
      .catch(() => {
        // Plain text is a complete rendering; highlighting is an enhancement.
      });
    return () => {
      cancelled = true;
    };
  }, [block.html, block.text, block.language]);

  return (
    <BlockFigure kind="code" caption={block.caption} cites={block.cites}>
      <div className={styles.frame}>
        {block.language ? <span className={styles.language}>{block.language}</span> : null}
        {html ? (
          <div className={styles.highlighted} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className={styles.pre} tabIndex={0}>
            <code>{block.text}</code>
          </pre>
        )}
      </div>
    </BlockFigure>
  );
}
