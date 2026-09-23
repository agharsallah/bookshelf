import type { ParagraphBlock as Paragraph } from '../../lib/contract';
import { Spans } from './Spans';
import styles from './Text.module.css';

export function ParagraphBlock({ block }: { block: Paragraph }) {
  return (
    <p className={styles.paragraph}>
      <Spans spans={block.spans} />
    </p>
  );
}
