/**
 * Cite chips on the study pages open the reader at the cited passage
 * (`/documents/{slug}/read/{anchor}`), as they do on the guide. Also the small `<Kbd>`
 * key hint the study controls share.
 */
import { useMemo, type ReactNode } from 'react';
import type { Anchor } from '../../lib/contract';
import { CiteProvider } from '../blocks/CiteContext';
import styles from './Study.module.css';

export function readerHref(slug: string): (anchor: Anchor) => string {
  return (anchor) => `/documents/${slug}/read/${anchor}`;
}

export function ReaderCites({ slug, children }: { slug: string; children: ReactNode }) {
  const value = useMemo(() => ({ citeHref: readerHref(slug) }), [slug]);
  return <CiteProvider value={value}>{children}</CiteProvider>;
}

/** A key hint beside a control; hidden from screen readers, which get `aria-keyshortcuts`. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className={styles.kbd} aria-hidden="true">
      {children}
    </kbd>
  );
}
