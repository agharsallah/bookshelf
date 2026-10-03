/** Server-side settings wire shapes (backend/app/schemas/settings.py, `GET /settings`). */

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
}
