import type { CalloutBlock as Callout } from '../../lib/contract';
import { TONES } from './callout-tones';
import { Spans } from './Spans';
import styles from './Callout.module.css';

export function CalloutBlock({ block }: { block: Callout }) {
  const tone = TONES[block.tone];
  const name = block.title ? `${tone.label}: ${block.title}` : tone.label;
  return (
    <aside className={styles.callout} data-tone={block.tone} aria-label={name}>
      <span className={styles.glyph} aria-hidden="true">
        {tone.glyph}
      </span>
      <div className={styles.body}>
        <p className={styles.head}>
          <span className={styles.label}>{tone.label}</span>
          {block.title ? <span className={styles.title}>{block.title}</span> : null}
        </p>
        <p className={styles.text}>
          <Spans spans={block.spans} />
        </p>
      </div>
    </aside>
  );
}
