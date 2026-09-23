/**
 * Shared frame for figure-like blocks (chart, diagram, code, math): the content,
 * then a caption line with the title/caption, a confidence note and the sources.
 */
import type { ReactNode } from 'react';
import type { Cites, Confidence } from '../../lib/contract';
import { BlockSources } from './CiteChip';
import styles from './Figure.module.css';

export interface BlockFigureProps {
  kind: string;
  caption?: string | undefined;
  cites: Cites;
  confidence?: Confidence | undefined;
  children: ReactNode;
  /** Extra attributes for the figure (e.g. `data-rendered`). */
  attrs?: Record<string, string | undefined>;
}

export function BlockFigure({ kind, caption, cites, confidence, children, attrs }: BlockFigureProps) {
  const uncertain = confidence === 'low' || confidence === 'medium';
  const hasCaption = Boolean(caption) || uncertain || cites.length > 0;
  return (
    <figure className={styles.figure} data-figure={kind} {...attrs}>
      {children}
      {hasCaption ? (
        <figcaption className={styles.caption}>
          {caption ? <span className={styles.captionText}>{caption}</span> : null}
          {uncertain ? (
            <span className={styles.confidence} data-confidence={confidence}>
              Transcribed with {confidence} confidence
            </span>
          ) : null}
          <BlockSources anchors={cites} />
        </figcaption>
      ) : null}
    </figure>
  );
}
