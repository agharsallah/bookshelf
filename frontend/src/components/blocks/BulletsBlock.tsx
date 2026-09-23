import type { BulletsBlock as Bullets } from '../../lib/contract';
import { Spans } from './Spans';
import styles from './Text.module.css';

export function BulletsBlock({ block }: { block: Bullets }) {
  return (
    <ul className={styles.bullets}>
      {block.items.map((item, index) => (
        <li key={index}>
          <Spans spans={item} />
        </li>
      ))}
    </ul>
  );
}
