/** Skill catalogue wire shapes (backend/app/schemas/skill.py, `GET /skills`). */
import type { ArtifactType, Tier } from './artifacts';
import type { JobKind } from './jobs';

export interface SkillGates {
  grounding_min: number;
  /** `[low, high]` share of the source's words, or null when the skill has no band. */
  compression: [number, number] | null;
  max_words: number | null;
  /** Spoken output: the words-per-minute band a script of the chosen length must land in. */
  words_per_minute?: [number, number] | null;
}

/** A run parameter: pick one of `choices` per job (`JobCreate.params`). */
export interface SkillParam {
  choices: (string | number)[];
  default: string | number;
  description: string;
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
  /** A chapter-scope skill that also runs on the whole book: the selector it reads with no anchor. */
  document_selector: string | null;
  vision: boolean;
  gates: SkillGates;
  params?: Record<string, SkillParam>;
  /** Its artifact is a script to be spoken: storing one queues a `narrate` job. */
  narrate?: boolean;
}
