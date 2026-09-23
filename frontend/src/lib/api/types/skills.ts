/** Skill catalogue wire shapes (backend/app/schemas/skill.py, `GET /skills`). */
import type { ArtifactType, Tier } from './artifacts';
import type { JobKind } from './jobs';

export interface SkillGates {
  grounding_min: number;
  /** `[low, high]` share of the source's words, or null when the skill has no band. */
  compression: [number, number] | null;
  max_words: number | null;
}

export interface SkillPublic {
  name: string;
  version: string;
  description: string;
  tier: Tier;
  job_kind: JobKind | null;
  artifact_type: ArtifactType | null;
  scope: string;
  selector: string;
  vision: boolean;
  gates: SkillGates;
}
