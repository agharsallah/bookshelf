import type { DefinitionBlock as Definition } from '../../lib/contract';
import { Spans } from './Spans';
import styles from './Text.module.css';

/** A glossary entry: the term, then its cited explanation. */
export function DefinitionBlock({ block }: { block: Definition }) {
  return (
    <dl className={styles.definition}>
      <dt className={styles.term}>
        <dfn>{block.term}</dfn>
      </dt>
      <dd className={styles.explanation}>
        <Spans spans={block.spans} />
      </dd>
    </dl>
  );
}
