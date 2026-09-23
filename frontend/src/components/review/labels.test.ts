import { describe, expect, it } from 'vitest';
import type { SkillPublic } from '../../lib/api/types/skills';
import { authorship, relativeTime, rerunRequest } from './labels';

describe('rerunRequest', () => {
  const scope = { document_id: 'd1', anchor: 'ch03', note_id: null };

  it('uses the job kind the producing skill declares', () => {
    const skills = [{ name: 'distil-section', job_kind: 'distil_section' } as SkillPublic];
    expect(rerunRequest({ ...scope, type: 'section_note', skill: 'distil-section' }, skills)).toEqual({ kind: 'distil_section', document_id: 'd1', anchor: 'ch03' });
  });

  it('falls back to the type’s producer for hand-written artifacts', () => {
    expect(rerunRequest({ ...scope, type: 'chapter_distillation', skill: null })?.kind).toBe('distil_chapter');
  });

  it('re-runs a derived artifact through derive with its skill', () => {
    expect(rerunRequest({ ...scope, type: 'quiz', skill: 'make-quiz' })).toEqual({ kind: 'derive', document_id: 'd1', anchor: 'ch03', skill: 'make-quiz' });
  });

  it('re-runs a structured note through structure_note with its note', () => {
    expect(rerunRequest({ ...scope, type: 'structured_note', skill: 'structure-note', note_id: 'n1' })).toEqual({
      kind: 'structure_note',
      document_id: 'd1',
      anchor: 'ch03',
      note_id: 'n1',
    });
  });

  it.each([
    ['quiz', null, null],
    ['structured_note', 'structure-note', null],
    ['outline_override', null, null],
  ] as const)('has no re-run for %s from skill %s without a note', (type, skill, note_id) => {
    expect(rerunRequest({ ...scope, type, skill, note_id })).toBeNull();
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
