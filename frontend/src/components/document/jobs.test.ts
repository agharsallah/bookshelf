// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { SkillPublic } from '../../lib/api/types/skills';
import { fakeApi } from '../review/testing/fakeApi';
import { deriveLabel, deriveSkills, enqueue } from './jobs';

const skill = (name: string, over: Partial<SkillPublic> = {}): SkillPublic => ({
  name,
  version: '1',
  description: name,
  tier: 'distil',
  job_kind: 'derive',
  artifact_type: null,
  scope: 'chapter',
  selector: 'chapter_distillation',
  vision: false,
  gates: { grounding_min: 0.9, compression: null, max_words: null },
  ...over,
});

const catalogue = [
  skill('make-quiz', { artifact_type: 'quiz' }),
  skill('make-glossary', { artifact_type: 'glossary', scope: 'document', selector: 'document_chapters' }),
  skill('extract-quotes', { artifact_type: 'quote_set', selector: 'scope_blocks' }),
  skill('distil-chapter', { job_kind: 'distil_chapter', artifact_type: 'chapter_distillation' }),
];

describe('derive skills', () => {
  it('keeps only derive skills of the scope, ordered by what they make', () => {
    expect(deriveSkills(catalogue, 'chapter').map(deriveLabel)).toEqual(['Make a quiz', 'Pick quotes']);
    expect(deriveSkills(catalogue, 'document').map((s) => s.name)).toEqual(['make-glossary']);
  });

  it('names an unknown artifact type by its skill', () => {
    expect(deriveLabel({ name: 'make-mindmap', artifact_type: null })).toBe('make-mindmap');
  });
});

describe('enqueue', () => {
  it('sends a derive with its skill and without force', async () => {
    const { api, calls } = fakeApi({ 'POST jobs': () => ({ job: {}, deduplicated: false }) });
    await enqueue(api, { kind: 'derive', documentId: 'd1', anchor: 'ch02', skill: catalogue[0] });
    expect(calls).toEqual([{ method: 'POST', path: 'jobs', body: { kind: 'derive', document_id: 'd1', anchor: 'ch02', force: false, skill: 'make-quiz' } }]);
  });

  it('forces a plain re-run', async () => {
    const { api, calls } = fakeApi({ 'POST jobs': () => ({ job: {}, deduplicated: false }) });
    await enqueue(api, { kind: 'brief', documentId: 'd1' });
    expect(calls[0]?.body).toEqual({ kind: 'brief', document_id: 'd1', anchor: null, force: true });
  });
});
