import { describe, expect, it } from 'vitest';
import type { SkillPublic } from '../../lib/api/types/skills';
import { authorship, relativeTime, rerunKind } from './labels';

describe('rerunKind', () => {
  it('uses the job kind the producing skill declares', () => {
    const skills = [{ name: 'distil-section', job_kind: 'distil_section' } as SkillPublic];
    expect(rerunKind({ type: 'section_note', skill: 'distil-section' }, skills)).toBe('distil_section');
  });

  it('falls back to the type’s producer for hand-written artifacts', () => {
    expect(rerunKind({ type: 'chapter_distillation', skill: null })).toBe('distil_chapter');
  });

  it.each(['quiz', 'faq', 'structured_note', 'outline_override'] as const)('has no re-run for %s', (type) => {
    expect(rerunKind({ type, skill: null })).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-23T12:00:00Z');

  it.each([
    ['2026-09-23T11:59:50Z', 'just now'],
    ['2026-09-23T11:15:00Z', '45 min ago'],
    ['2026-09-23T07:00:00Z', '5 h ago'],
    ['2026-09-20T12:00:00Z', '3 d ago'],
    ['2026-06-01T12:00:00Z', '2026-06-01'],
  ])('%s → %s', (iso, text) => {
    expect(relativeTime(iso, now)).toBe(text);
  });
});

describe('authorship', () => {
  it('names the skill and version, or says by hand', () => {
    expect(authorship({ origin: 'skill', skill: 'summarize', skill_version: '2' })).toBe('summarize@2');
    expect(authorship({ origin: 'human', skill: null, skill_version: null })).toBe('by hand');
  });
});
