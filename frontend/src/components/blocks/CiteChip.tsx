/**
 * Cite chips: the marginal marker after a claim. Each shows a compact, book-like
 * label (`3.2 ¶14`), reveals the full anchor on hover/focus, and links to the source.
 */
import type { MouseEvent } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { Anchor } from '../../lib/contract';
import { useCite } from './CiteContext';
import styles from './CiteChip.module.css';

export function CiteChip({ anchor }: { anchor: Anchor }) {
  const { citeHref, onCite, citeLabel, citeTitle } = useCite();
  const title = citeTitle ? citeTitle(anchor) : anchor;
  const handleClick = onCite
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onCite(anchor);
      }
    : undefined;
  return (
    <a
      className={styles.chip}
      href={citeHref(anchor)}
      data-anchor={anchor}
      aria-label={`Source ${title}`}
      onClick={handleClick}
    >
      <span aria-hidden="true">{citeLabel ? citeLabel(anchor) : anchorLabel(anchor)}</span>
      <span className={styles.tip} aria-hidden="true">
        {title}
      </span>
    </a>
  );
}

/** Superscript chips trailing a span. */
export function CiteMarks({ anchors }: { anchors: readonly Anchor[] }) {
  if (anchors.length === 0) return null;
  return (
    <sup className={styles.marks}>
      {anchors.map((anchor) => (
        <CiteChip key={anchor} anchor={anchor} />
      ))}
    </sup>
  );
}

/** Block-level sources (charts, code, quotes…): a quiet line of chips. */
export function BlockSources({ anchors }: { anchors: readonly Anchor[] }) {
  if (anchors.length === 0) return null;
  return (
    <span className={styles.sources}>
      <span className={styles.sourcesLabel}>{anchors.length === 1 ? 'Source' : 'Sources'}</span>
      {anchors.map((anchor) => (
        <CiteChip key={anchor} anchor={anchor} />
      ))}
    </span>
  );
}
