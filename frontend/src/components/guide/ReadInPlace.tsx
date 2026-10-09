/**
 * "Read" links that open the passage in place: inside a `ReadInPlace`, a plain click on a
 * `ReadLink` opens the chapter in the guide's drawer (PassagePanel), scrolled to the
 * passage and marked, with previous / next through the book and "Open in reader".
 * A ⌘/Ctrl/Shift/middle click, a link outside any `ReadInPlace`, and a passage outside
 * every chapter (or a book whose outline fails to load) follow the link into the reader.
 *
 *   <ReadInPlace>
 *     … <ReadLink slug={slug} anchor={anchor}>Read</ReadLink> …
 *   </ReadInPlace>
 */
import { createContext, useCallback, useContext, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { isPlainClick } from '../blocks/CiteChip';
import { readerHref } from '../search/links';
import { PassagePanel, type PassageTarget } from './PassagePanel';
import { loadUnits, unitOfAnchor, type PassageUnit } from './passage';

type Open = (slug: string, anchor: string) => void;

const OpenPassage = createContext<Open | null>(null);

interface Shown {
  slug: string;
  units: PassageUnit[];
  target: PassageTarget;
}

/** Hosts the drawer for every `ReadLink` inside it. */
export function ReadInPlace({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const open = useCallback<Open>((slug, anchor) => {
    const leave = () => window.location.assign(readerHref(slug, anchor));
    loadUnits(slug).then((units) => {
      const unit = unitOfAnchor(units, anchor);
      if (unit) setShown({ slug, units, target: { unit, anchor } });
      else leave();
    }, leave);
  }, []);
  const readHref = useCallback((anchor: string) => (shown ? readerHref(shown.slug, anchor) : '#'), [shown]);

  return (
    <OpenPassage.Provider value={open}>
      {children}
      {shown ? (
        <PassagePanel
          key={shown.slug}
          slug={shown.slug}
          units={shown.units}
          target={shown.target}
          onTarget={(target) => setShown({ ...shown, target })}
          onClose={() => setShown(null)}
          readHref={readHref}
        />
      ) : null}
    </OpenPassage.Provider>
  );
}

/**
 * The drawer's opener, for islands that open passages from their own controls (a pill's
 * cite or `o` key); null outside any `ReadInPlace`.
 */
export function usePassageOpener(): Open | null {
  return useContext(OpenPassage);
}

export interface ReadLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  slug: string;
  /** The passage or chapter to open. */
  anchor: string;
}

/** A link into the reader that opens in place inside a `ReadInPlace`. */
export function ReadLink({ slug, anchor, onClick, children, ...rest }: ReadLinkProps) {
  const open = useContext(OpenPassage);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!open || event.defaultPrevented || !isPlainClick(event)) return;
    event.preventDefault();
    open(slug, anchor);
  };
  return (
    <a {...rest} href={readerHref(slug, anchor)} onClick={follow}>
      {children}
    </a>
  );
}
