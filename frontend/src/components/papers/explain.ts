/**
 * The explainer tab's level switch: which levels exist (one `paper_explainer` variant
 * each), which one to show, and the request that makes a missing one (a `derive` job of
 * simplify-paper with `params.level`, like an audio episode).
 */
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import type { JobCreate } from '../../lib/api/types/jobs';
import { EXPLAINER_LEVELS, type ExplainerLevel } from '../../lib/api/types/papers';
import { pickBest, type Chosen } from '../../lib/documents/artifacts';
import { LEVEL_LABELS } from './labels';
import { paperHref } from './tabs';

export const EXPLAIN_SKILL = 'simplify-paper';

/** The level the pipeline makes by itself when the card is approved (profile.PAPER_DERIVES). */
export const DEFAULT_LEVEL: ExplainerLevel = 'practitioner';

export function isLevel(value: string | null | undefined): value is ExplainerLevel {
  return (EXPLAINER_LEVELS as readonly (string | null | undefined)[]).includes(value);
}

export interface LevelOption<A extends ArtifactPublic = ArtifactPublic> {
  level: ExplainerLevel;
  name: string;
  hint: string;
  href: string;
  /** The version to show at this level, or null when none exists yet. */
  chosen: Chosen<A> | null;
  current: boolean;
}

/**
 * Every level with its best version (approved, else newest draft) and link. The level
 * shown is the one asked for; else the default level if it exists, else the first that
 * exists, else the default.
 */
export function levelOptions<A extends ArtifactPublic>(slug: string, artifacts: readonly A[], requested: string | null): LevelOption<A>[] {
  const chosen = new Map(
    EXPLAINER_LEVELS.map((level) => [
      level,
      pickBest(
        artifacts.filter((a) => a.variant === level),
        'paper_explainer',
        null,
      ),
    ]),
  );
  const existing = EXPLAINER_LEVELS.filter((level) => chosen.get(level));
  const current: ExplainerLevel = isLevel(requested)
    ? requested
    : chosen.get(DEFAULT_LEVEL)
      ? DEFAULT_LEVEL
      : (existing[0] ?? DEFAULT_LEVEL);
  return EXPLAINER_LEVELS.map((level) => ({
    level,
    ...LEVEL_LABELS[level],
    href: paperHref(slug, 'explain', { level }),
    chosen: chosen.get(level) ?? null,
    current: level === current,
  }));
}

export function explainRequest(documentId: string, level: ExplainerLevel): JobCreate {
  return { kind: 'derive', document_id: documentId, skill: EXPLAIN_SKILL, params: { level } };
}
