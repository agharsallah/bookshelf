/**
 * Any artifact body, drawn with `<Blocks>` after the adapter maps it onto the closed
 * block set. Facts (kind, caption, tags…) and self-reported confidence sit above it.
 */
import { useMemo } from 'react';
import type { ArtifactType } from '../../../lib/api/types/artifacts';
import type { Anchor } from '../../../lib/contract';
import { Blocks } from '../../blocks/Blocks';
import { adaptBody, type AdaptedBody } from './adapters';
import styles from './ArtifactBody.module.css';

export function BodyFacts({ adapted }: { adapted: AdaptedBody }) {
  if (adapted.facts.length === 0 && !adapted.confidence) return null;
  return (
    <dl className={styles.facts}>
      {adapted.facts.map((fact) => (
        <div key={fact.label} className={styles.fact}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
      {adapted.confidence ? (
        <div className={styles.fact} data-confidence={adapted.confidence}>
          <dt>Confidence</dt>
          <dd>{adapted.confidence}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export interface ArtifactBodyProps {
  type: ArtifactType;
  body: unknown;
  onCite?: ((anchor: Anchor) => void) | undefined;
}

export function ArtifactBody({ type, body, onCite }: ArtifactBodyProps) {
  const adapted = useMemo(() => adaptBody(type, body), [type, body]);
  return (
    <div className={styles.body}>
      <BodyFacts adapted={adapted} />
      {adapted.blocks.length > 0 ? (
        <Blocks blocks={adapted.blocks} onCite={onCite} />
      ) : (
        <p className={styles.empty}>This artifact has no content to show.</p>
      )}
    </div>
  );
}
