/**
 * Evidence passages, each with its book, its place (`3.2 ¶14`, linking into the reader,
 * or opening in place inside a `ReadInPlace`) and the words themselves. Works statically
 * in .astro pages and inside islands.
 * A passage whose anchor vanished on a re-parse is shown as such, not hidden.
 */
import { anchorLabel } from '../../lib/anchors';
import type { Passage } from '../../lib/api/types/graph';
import { ReadLink } from '../guide/ReadInPlace';
import styles from './Concepts.module.css';

export interface PassageListProps {
  passages: readonly Passage[];
  /** Hide the book title when every passage comes from the same one. */
  showBook?: boolean;
}

export function PassageList({ passages, showBook = true }: PassageListProps) {
  const seen = new Set<string>();
  const unique = passages.filter((p) => (seen.has(p.ref) ? false : (seen.add(p.ref), true)));
  return (
    <ul className={styles.passages}>
      {unique.map((p) => {
        const slug = p.document && p.exists ? p.document.slug : null;
        return (
          <li key={p.ref} className={styles.passage} data-missing={p.exists ? undefined : ''}>
            <p className={styles.where}>
              {showBook && p.document ? <span className={styles.book}>{p.document.title}</span> : null}
              {slug ? (
                <ReadLink slug={slug} anchor={p.anchor} className={styles.place}>
                  {anchorLabel(p.anchor)}
                </ReadLink>
              ) : (
                <span className={styles.place}>{anchorLabel(p.anchor)}</span>
              )}
              {p.heading ? <span className={styles.heading}>{p.heading}</span> : null}
            </p>
            {p.exists ? (
              p.snippet ? <blockquote className={styles.snippet}>{p.snippet}</blockquote> : null
            ) : (
              <p className={styles.missing}>This passage no longer exists: the book was parsed again and the anchor moved.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
