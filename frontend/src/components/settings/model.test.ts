import { describe, expect, it } from 'vitest';
import type { AutoDeriveChoice } from '../../lib/api/types/settings';
import { enabledSkills, sortedChoices, withToggled } from './model';

const CHOICES: AutoDeriveChoice[] = [
  { skill: 'make-quiz', description: '', enabled: true },
  { skill: 'make-faq', description: '', enabled: false },
  { skill: 'make-glossary', description: '', enabled: true },
];

describe('auto-run choices', () => {
  it('lists the skills that are on', () => {
    expect(enabledSkills(CHOICES)).toEqual(['make-quiz', 'make-glossary']);
  });

  it('flips one skill and leaves the others', () => {
    const next = withToggled(CHOICES, 'make-faq');

    expect(enabledSkills(next)).toEqual(['make-quiz', 'make-faq', 'make-glossary']);
    expect(enabledSkills(withToggled(next, 'make-quiz'))).toEqual(['make-faq', 'make-glossary']);
    expect(enabledSkills(CHOICES)).toEqual(['make-quiz', 'make-glossary']);
  });

  it('names skills by what they make, alphabetically', () => {
    expect(sortedChoices(CHOICES).map((c) => c.label)).toEqual(['Make a glossary', 'Make a quiz', 'Write an FAQ']);
  });
});
