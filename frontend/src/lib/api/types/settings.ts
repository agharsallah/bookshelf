/** Server-side settings wire shapes (backend/app/schemas/settings.py, `GET /settings`). */
import type { BuildDefaults } from './builds';

export interface AutoDeriveChoice {
  skill: string;
  description: string;
  enabled: boolean;
}

export type AutoDeriveGroup = 'book' | 'paper';

/** Which of a skill's new artifacts are approved on arrival, without a review. */
export type AutoApprove = 'off' | 'passing' | 'all';

export interface SettingsPublic {
  auto_derive: Record<AutoDeriveGroup, AutoDeriveChoice[]>;
  auto_approve: AutoApprove;
  /** Defaults of a new build (docs/BUILDS.md §4). */
  builds: BuildDefaults;
}
