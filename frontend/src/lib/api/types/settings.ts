/** Server-side settings wire shapes (backend/app/schemas/settings.py, `GET /settings`). */

export interface AutoDeriveChoice {
  skill: string;
  description: string;
  enabled: boolean;
}

export type AutoDeriveGroup = 'book' | 'paper';

export interface SettingsPublic {
  auto_derive: Record<AutoDeriveGroup, AutoDeriveChoice[]>;
}
