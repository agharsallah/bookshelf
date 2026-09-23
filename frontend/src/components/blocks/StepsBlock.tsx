import type { StepsBlock as Steps } from '../../lib/contract';
import { Spans } from './Spans';
import styles from './Text.module.css';

/** Ordered procedure; numbers hang in the margin as old-style figures. */
export function StepsBlock({ block }: { block: Steps }) {
  return (
    <ol className={styles.steps}>
      {block.items.map((item, index) => (
        <li key={index}>
          <Spans spans={item} />
        </li>
      ))}
    </ol>
  );
}
