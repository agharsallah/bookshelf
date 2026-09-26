/**
 * Quotes (island): lines worth keeping, verbatim, as pull quotes with who said them, the
 * page, and a cite chip that opens the passage. Each can be copied, with its attribution.
 */
import { useEffect, useRef, useState } from 'react';
import type { QuoteBlock } from '../../lib/contract';
import { CiteChip } from '../blocks/CiteChip';
import { ReaderCites } from './ReaderCites';
import styles from './Quotes.module.css';

export interface QuotesProps {
  slug: string;
  /** Shown as the source when a quote names no one. */
  bookTitle: string;
  quotes: QuoteBlock[];
}

/** What Copy puts on the clipboard: the quote in curly quotes, then who said it and where. */
export function quoteForClipboard(quote: QuoteBlock, bookTitle: string): string {
  const source = [quote.attribution, bookTitle, quote.page !== null ? `p. ${quote.page}` : ''].filter(Boolean).join(', ');
  return `“${quote.text}” — ${source}`;
}

export function Quotes({ slug, bookTitle, quotes }: QuotesProps) {
  return (
    <ReaderCites slug={slug}>
      <ol className={styles.quotes} aria-label="Quotes">
        {quotes.map((quote, index) => (
          <li key={index}>
            <Quote quote={quote} bookTitle={bookTitle} />
          </li>
        ))}
      </ol>
    </ReaderCites>
  );
}

function Quote({ quote, bookTitle }: { quote: QuoteBlock; bookTitle: string }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(quoteForClipboard(quote, bookTitle));
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2400);
  };

  return (
    <figure className={styles.quote}>
      <blockquote className={styles.text}>
        <p>{quote.text}</p>
      </blockquote>
      <figcaption className={styles.caption}>
        <span className={styles.who}>{quote.attribution ?? bookTitle}</span>
        {quote.page !== null ? <span className={styles.page}>p. {quote.page}</span> : null}
        {quote.cites.map((anchor) => (
          <CiteChip key={anchor} anchor={anchor} />
        ))}
        <span className={styles.spacer} />
        <button type="button" className={`btn btn-quiet ${styles.copy}`} onClick={() => void copy()} data-copied={copied ?? undefined}>
          {copied === 'yes' ? 'Copied' : 'Copy'}
        </button>
        <span className="visually-hidden" aria-live="polite">
          {copied === 'yes' ? 'Quote copied' : copied === 'failed' ? 'Could not copy. Select the quote and copy it instead.' : ''}
        </span>
      </figcaption>
    </figure>
  );
}

export default Quotes;
