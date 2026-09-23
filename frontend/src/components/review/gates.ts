/**
 * Gate badges (§14) derived from an artifact's stored gate record and its skill's
 * thresholds. Pure: the badges components only draw what this returns.
 */
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import type { SkillGates } from '../../lib/api/types/skills';

/** Default grounding threshold (§14) when the skill is unknown. */
export const GROUNDING_MIN = 0.9;

export type GateTone = 'fail' | 'warn' | 'info';

export interface GroundingGate {
  score: number;
  min: number;
  passed: boolean;
}

export interface CompressionGate {
  ratio: number;
  band: readonly [number, number] | null;
  status: 'within' | 'low' | 'high' | 'unbanded';
}

export interface GateFlag {
  key: string;
  label: string;
  tone: GateTone;
  /** A longer explanation for a tooltip or the detail view. */
  detail: string;
}

export interface GateSummary {
  grounding: GroundingGate | null;
  compression: CompressionGate | null;
  words: number | null;
  flags: GateFlag[];
  /** D15: human-authored artifacts skip grounding and compression. */
  bypassed: boolean;
  /** No failing gate and no warning flag: safe for bulk approval. */
  passesAll: boolean;
}

function flagFor(raw: string): GateFlag | null {
  if (raw === 'grounding_below_min' || raw === 'compression_low' || raw === 'compression_high') {
    return null; // drawn by the grounding meter and the compression badge
  }
  if (raw.startsWith('duplicate_of:')) {
    const anchor = raw.slice('duplicate_of:'.length);
    return {
      key: raw,
      label: `Repeats ${anchor}`,
      tone: 'warn',
      detail: `Overlaps heavily with the sibling note at ${anchor}; the brief's dedup pass will see it.`,
    };
  }
  switch (raw) {
    case 'low_confidence':
      return {
        key: raw,
        label: 'Low confidence',
        tone: 'fail',
        detail: 'The skill reported low confidence in its reading; distillations will not cite it until approved.',
      };
    case 'over_max_words':
      return { key: raw, label: 'Too long', tone: 'warn', detail: 'Longer than the skill allows.' };
    case 'code_not_verbatim':
      return {
        key: raw,
        label: 'Code rewritten',
        tone: 'fail',
        detail: 'A code block citing the listing does not reproduce it byte for byte.',
      };
    default:
      return { key: raw, label: raw.replaceAll('_', ' '), tone: 'warn', detail: raw };
  }
}

function compressionStatus(ratio: number, band: readonly [number, number] | null): CompressionGate['status'] {
  if (!band) return 'unbanded';
  if (ratio < band[0]) return 'low';
  if (ratio > band[1]) return 'high';
  return 'within';
}

export function deriveGates(
  artifact: Pick<ArtifactPublic, 'gates' | 'origin'>,
  thresholds?: SkillGates | null,
): GateSummary {
  const record = artifact.gates;
  const bypassed = artifact.origin === 'human';
  const min = thresholds?.grounding_min ?? GROUNDING_MIN;

  const grounding =
    typeof record.grounding === 'number'
      ? { score: record.grounding, min, passed: record.grounding >= min }
      : null;

  const band = thresholds?.compression ?? null;
  const compression =
    typeof record.compression === 'number'
      ? { ratio: record.compression, band, status: compressionStatus(record.compression, band) }
      : null;

  const flags = (record.flags ?? []).map(flagFor).filter((f): f is GateFlag => f !== null);
  if (record.schema_retry) {
    flags.push({
      key: 'schema_retry',
      label: 'Schema retry',
      tone: 'info',
      detail: 'The first output failed the schema; this is the corrected retry.',
    });
  }

  const compressionOk = !compression || compression.status === 'within' || compression.status === 'unbanded';
  const passesAll =
    (grounding?.passed ?? true) && compressionOk && flags.every((f) => f.tone === 'info');

  return { grounding, compression, words: record.words ?? null, flags, bypassed, passesAll };
}

/** Format a share as a whole percentage: 0.873 → `87%`. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
