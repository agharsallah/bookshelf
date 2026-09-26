/**
 * Gate marks (§14), read like a proofreader's marginal notes: a grounding meter with the
 * threshold drawn as a load line, the compression ratio against its band, and flags.
 */
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import type { SkillGates } from '../../lib/api/types/skills';
import { deriveGates, percent, type CompressionGate, type GroundingGate } from './gates';
import styles from './GateBadges.module.css';

export function GroundingMeter({ gate, compact = false }: { gate: GroundingGate; compact?: boolean }) {
  const label = `Grounding ${percent(gate.score)}, threshold ${percent(gate.min)}`;
  return (
    <span className={styles.meterWrap} data-passed={gate.passed} title={label}>
      <span
        className={styles.meter}
        role="meter"
        aria-label="Grounding"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(gate.score * 100)}
        aria-valuetext={label}
      >
        <span className={styles.fill} style={{ inlineSize: percent(gate.score) }} />
        <span className={styles.line} style={{ insetInlineStart: percent(gate.min) }} aria-hidden="true" />
      </span>
      <span className={styles.value}>
        {percent(gate.score)}
        {compact ? null : <span className={styles.unit}> grounded, needs {percent(gate.min)}</span>}
      </span>
    </span>
  );
}

const COMPRESSION_WORDS: Record<CompressionGate['status'], string> = {
  within: 'within band',
  low: 'below band, may skip content',
  high: 'above band, may copy the source',
  unbanded: 'no band',
};

export function CompressionBadge({ gate }: { gate: CompressionGate }) {
  const band = gate.band ? `${percent(gate.band[0])}–${percent(gate.band[1])}` : null;
  const title = `${percent(gate.ratio)} of the source's words; ${COMPRESSION_WORDS[gate.status]}${band ? ` (${band})` : ''}`;
  return (
    <span className={styles.compression} data-status={gate.status} title={title}>
      <span className="visually-hidden">Compression: </span>
      {percent(gate.ratio)} of source
      {band ? <span className={styles.band}> / {band}</span> : null}
    </span>
  );
}

export interface GateBadgesProps {
  artifact: Pick<ArtifactPublic, 'gates' | 'origin'>;
  thresholds?: SkillGates | null | undefined;
  /** Row variant: meter without its unit, flags abbreviated to their label. */
  compact?: boolean;
}

export function GateBadges({ artifact, thresholds, compact = false }: GateBadgesProps) {
  const gates = deriveGates(artifact, thresholds);
  return (
    <span className={compact ? `${styles.gates} ${styles.compact}` : styles.gates}>
      {gates.bypassed ? <span className={styles.bypass}>Written by hand, not scored</span> : null}
      {gates.grounding ? <GroundingMeter gate={gates.grounding} compact={compact} /> : null}
      {gates.compression ? <CompressionBadge gate={gates.compression} /> : null}
      {gates.flags.map((flag) => (
        <span key={flag.key} className={styles.flag} data-tone={flag.tone} title={flag.detail}>
          {flag.label}
        </span>
      ))}
    </span>
  );
}
