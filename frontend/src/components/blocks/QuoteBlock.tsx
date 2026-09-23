import type { QuoteBlock as Quote } from '../../lib/contract';
import { BlockSources } from './CiteChip';
import styles from './Quote.module.css';

/** A verbatim passage, never paraphrased; the page number is part of the contract. */
export function QuoteBlock({ block }: { block: Quote }) {
  return (
    <figure className={styles.quote}>
      <blockquote className={styles.text}>
        <p>{block.text}</p>
      </blockquote>
      <figcaption className={styles.caption}>
        {block.attribution ? <span className={styles.attribution}>{block.attribution}</span> : null}
        {block.page !== null ? <span className={styles.page}>p. {block.page}</span> : null}
        <BlockSources anchors={block.cites} />
      </figcaption>
    </figure>
  );
}
