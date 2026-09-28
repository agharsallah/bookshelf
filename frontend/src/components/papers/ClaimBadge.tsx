/**
 * A claim's identity at a glance: its key (C2), its kind, and how strongly the paper
 * backs it. Strength is drawn as the rule beside the key (solid: measured, open:
 * argued, dashed: speculated) and always named in words too. Used by the claims tab and
 * the reader's margin marks.
 */
import type { ClaimKind, ClaimStrength } from '../../lib/api/types/papers';
import { CONTRIBUTION_LABELS } from './bodies';
import { STRENGTH_LABELS } from './study-labels';
import styles from './Claims.module.css';

export interface ClaimBadgeProps {
  claimKey: string;
  strength: ClaimStrength;
  /** Leave out where the kind is already shown (the reader's compact margin). */
  kind?: ClaimKind;
}

export function ClaimBadge({ claimKey, strength, kind }: ClaimBadgeProps) {
  const s = STRENGTH_LABELS[strength];
  return (
    <span className={styles.badge} data-strength={strength}>
      <span className={styles.key}>{claimKey}</span>
      {kind ? <span className={styles.kindChip}>{CONTRIBUTION_LABELS[kind]}</span> : null}
      <span className={styles.strengthChip} title={s.hint}>
        {s.name}
      </span>
    </span>
  );
}

export default ClaimBadge;
