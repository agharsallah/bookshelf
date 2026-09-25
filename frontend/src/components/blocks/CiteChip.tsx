/**
 * Cite chips: the marginal marker after a claim. Each shows a compact, book-like
 * label (`3.2 ¶14`), reveals the full anchor on hover/focus, and links to the source.
 */
import type { ComponentProps, MouseEvent } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { Anchor } from '../../lib/contract';
import { useCite } from './CiteContext';
import styles from './CiteChip.module.css';

/**
 * A click the page may handle itself: the primary button with no modifier. ⌘/Ctrl-click,
 * Shift-click and the middle button keep the browser's own "open in a new tab/window".
 */
export function isPlainClick(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** The click handler for a link to `anchor`: `onCite` on a plain click, else the link. */
function useCiteClick(anchor: Anchor): ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined {
  const { onCite } = useCite();
  if (!onCite) return undefined;
  return (event) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    onCite(anchor);
  };
}

/** Any link into the source (a chapter title, a heatmap cell) that behaves like a cite chip. */
export function SourceLink({ anchor, children, ...rest }: { anchor: Anchor } & Omit<ComponentProps<'a'>, 'href' | 'onClick'>) {
  const { citeHref } = useCite();
  return (
    <a {...rest} href={citeHref(anchor)} data-anchor={anchor} onClick={useCiteClick(anchor)}>
      {children}
    </a>
  );
}

export function CiteChip({ anchor }: { anchor: Anchor }) {
  const { citeHref, citeLabel, citeTitle } = useCite();
  const title = citeTitle ? citeTitle(anchor) : anchor;
  const label = citeLabel ? citeLabel(anchor) : anchorLabel(anchor);
  const handleClick = useCiteClick(anchor);
  return (
    <a
      className={styles.chip}
      href={citeHref(anchor)}
      data-anchor={anchor}
      // Starts with the visible label (WCAG 2.5.3), then the full address.
      aria-label={`${label}, source ${title}`}
      onClick={handleClick}
    >
      <span aria-hidden="true">{label}</span>
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
    <sup className={styles.marks} data-cites="">
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
    <span className={styles.sources} data-cites="">
      <span className={styles.sourcesLabel}>{anchors.length === 1 ? 'Source' : 'Sources'}</span>
      {anchors.map((anchor) => (
        <CiteChip key={anchor} anchor={anchor} />
      ))}
    </span>
  );
}
