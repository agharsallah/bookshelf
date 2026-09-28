/**
 * A section the pass sets aside: its heading, how long it is, and a way to unfold it. The
 * text before a unit's first heading shows no heading (the toolbar names the unit), only
 * "Opening, set aside for this pass: …".
 * It keeps the heading's anchor as a source block, so the contents rail, the URL and the
 * saved position follow it like the heading it stands for.
 */
import { memo } from 'react';
import { foldLabel, type Fold } from './passes';
import styles from './Paper.module.css';

export interface FoldedSectionProps {
  fold: Fold;
  onUnfold: (anchor: string) => void;
}

function FoldedSectionImpl({ fold, onUnfold }: FoldedSectionProps) {
  const Tag = fold.level <= 1 ? 'h2' : fold.level === 2 ? 'h3' : 'h4';
  const empty = fold.members.length === 0;
  return (
    <div id={fold.anchor} className={styles.fold} data-source-anchor={fold.anchor} data-kind="section" data-folded={empty ? undefined : ''} tabIndex={-1}>
      {fold.lead ? null : <Tag className={styles.foldHeading}>{fold.heading}</Tag>}
      {empty ? null : (
        <p className={styles.foldMeta}>
          <span>{fold.lead ? `${fold.heading}, set aside for this pass: ` : 'Set aside for this pass: '}{foldLabel(fold)}</span>
          <button type="button" className={styles.foldOpen} onClick={() => onUnfold(fold.anchor)}>
            Read it anyway<span className="visually-hidden">: {fold.heading}</span>
          </button>
        </p>
      )}
    </div>
  );
}

export const FoldedSection = memo(FoldedSectionImpl);
