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

/** When the pills feed composes pills on its own (docs/PILLS.md §5). */
export interface PillsSettings {
  /** A feed running low queues make-pills for chapters with no composed pills yet. */
  auto_generate: boolean;
  /** At most this many chapters a day (1-50) from those top-ups. */
  max_chapters_per_day: number;
}

export interface SettingsPublic {
  auto_derive: Record<AutoDeriveGroup, AutoDeriveChoice[]>;
  auto_approve: AutoApprove;
  /** Defaults of a new build (docs/BUILDS.md §4). */
  builds: BuildDefaults;
  pills: PillsSettings;
}
