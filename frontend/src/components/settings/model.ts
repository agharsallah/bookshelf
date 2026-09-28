/** Settings page logic that needs no DOM: which skills a group has on, and the next list. */
import type { AutoDeriveChoice } from '../../lib/api/types/settings';
import { deriveLabel } from '../document/jobs';

export function enabledSkills(choices: readonly AutoDeriveChoice[]): string[] {
  return choices.filter((c) => c.enabled).map((c) => c.skill);
}

/** The group's choices with `skill` switched on or off. */
export function withToggled(choices: readonly AutoDeriveChoice[], skill: string): AutoDeriveChoice[] {
  return choices.map((c) => (c.skill === skill ? { ...c, enabled: !c.enabled } : c));
}

/** A skill as the person knows it ("Make a quiz"), in a stable order. */
export function sortedChoices(choices: readonly AutoDeriveChoice[]): { choice: AutoDeriveChoice; label: string }[] {
  return choices
    .map((choice) => ({ choice, label: deriveLabel({ name: choice.skill }) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
