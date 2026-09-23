/**
 * `<Blocks>` — the render contract (§9), implemented once and reused by the reader,
 * briefs, search results and notes.
 *
 * - Static: `<Blocks blocks={await prepareBlocks(raw)} />` in any .astro page, no
 *   hydration needed (code and math arrive pre-rendered; diagrams are drawn by the
 *   layout's enhancer).
 * - Interactive: render it inside an island and pass `onCite` to intercept cite
 *   clicks (e.g. scroll the source pane) instead of following `citeHref`.
 */
import { useMemo } from 'react';
import { defaultCiteHref } from '../../lib/anchors';
import type { RenderBlock } from '../../lib/contract';
import type { PreparedBlock } from '../../lib/prepare';
import { CiteProvider, type CiteOptions } from './CiteContext';
import { componentFor } from './registry';
import { UnknownBlock } from './UnknownBlock';
import styles from './Blocks.module.css';

export interface BlocksProps extends CiteOptions {
  /** Contract blocks, ideally passed through `prepareBlocks` first. */
  blocks: readonly (PreparedBlock | RenderBlock)[];
  className?: string;
}

export function Blocks({ blocks, onCite, citeHref = defaultCiteHref, citeLabel, citeTitle, className }: BlocksProps) {
  const cite = useMemo(() => ({ onCite, citeHref, citeLabel, citeTitle }), [onCite, citeHref, citeLabel, citeTitle]);
  return (
    <CiteProvider value={cite}>
      <div className={className ? `${styles.blocks} ${className}` : styles.blocks} data-blocks="">
        {blocks.map((block, index) => {
          const Component = componentFor((block as { type?: unknown }).type);
          return (
            <div key={index} className={styles.block} data-block={block.type}>
              {Component ? <Component block={block} /> : <UnknownBlock block={block} />}
            </div>
          );
        })}
      </div>
    </CiteProvider>
  );
}

export default Blocks;
