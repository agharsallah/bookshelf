/**
 * Shared frame for figure-like blocks (chart, diagram, code, math): the content,
 * then a caption line with the title/caption, a confidence note and the sources.
 * Drawn figures (charts, diagrams) get a Magnify button when the page offers one.
 */
import { useRef, type ReactNode } from 'react';
import type { Cites, Confidence } from '../../lib/contract';
import { BlockSources } from './CiteChip';
import { useMagnify } from './MagnifyContext';
import styles from './Figure.module.css';

const DRAWN = new Set(['chart', 'diagram']);
const KIND_NAMES: Record<string, string> = { chart: 'Chart', diagram: 'Diagram' };

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
  const magnify = useMagnify();
  const figure = useRef<HTMLElement>(null);
  const name = caption ?? KIND_NAMES[kind] ?? 'Figure';
  const onMagnify = () => {
    const svg = figure.current?.querySelector('svg');
    if (svg && magnify) magnify({ html: svg.outerHTML, title: name, alt: svg.getAttribute('aria-label') ?? name });
  };
  return (
    <figure ref={figure} className={styles.figure} data-figure={kind} {...attrs}>
      {magnify && DRAWN.has(kind) ? (
        <button type="button" className={styles.magnify} aria-label={`Magnify: ${name}`} title="Magnify" onClick={onMagnify}>
          ⤢
        </button>
      ) : null}
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
