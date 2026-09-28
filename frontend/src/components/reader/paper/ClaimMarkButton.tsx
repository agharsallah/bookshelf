/**
 * The margin mark of a block that is evidence for one of the paper's claims: its claim
 * keys and, when shelf papers relate to it, a tally (supported, contradicted, extended).
 * The counts carry a sign as well as a colour, so the tally reads without colour.
 */
import { memo } from 'react';
import { claimMarkLabel, type BlockClaims } from './claimMarks';
import styles from './Paper.module.css';

export interface ClaimMarkButtonProps {
  block: BlockClaims;
  open: boolean;
  onOpen: (anchor: string, button: HTMLElement) => void;
}

function ClaimMarkButtonImpl({ block, open, onOpen }: ClaimMarkButtonProps) {
  const keys = block.claims.map((c) => c.key);
  return (
    <button
      type="button"
      className={styles.claimMark}
      data-claim-mark={block.anchor}
      aria-expanded={open}
      aria-label={claimMarkLabel(block)}
      onClick={(event) => onOpen(block.anchor, event.currentTarget)}
    >
      <span className={styles.claimKeys}>{keys.length > 2 ? `${keys[0] ?? ''}+${keys.length - 1}` : keys.join(' ')}</span>
      {block.supported_by || block.contradicted_by || block.extended_by ? (
        <span className={styles.claimTally} aria-hidden="true">
          {block.supported_by ? <span data-relation="supports">+{block.supported_by}</span> : null}
          {block.contradicted_by ? <span data-relation="contradicts">−{block.contradicted_by}</span> : null}
          {block.extended_by ? <span data-relation="extends">↗{block.extended_by}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

export const ClaimMarkButton = memo(ClaimMarkButtonImpl);
