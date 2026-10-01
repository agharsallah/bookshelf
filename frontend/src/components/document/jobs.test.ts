// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { SkillPublic } from '../../lib/api/types/skills';
import { fakeApi } from '../review/testing/fakeApi';
import { deriveLabel, deriveSkills, enqueue, jobTitle, needsDistillation } from './jobs';
import { toast } from './toast';

vi.mock('./toast', () => ({ toast: vi.fn() }));

const skill = (name: string, over: Partial<SkillPublic> = {}): SkillPublic => ({
  name,
  version: '1',
  description: name,
  tier: 'distil',
  job_kind: 'derive',
  artifact_type: null,
  scope: 'chapter',
  selector: 'chapter_distillation',
  document_selector: null,
  vision: false,
  gates: { grounding_min: 0.9, compression: null, max_words: null },
  ...over,
});

const catalogue = [
  skill('make-quiz', { artifact_type: 'quiz', document_selector: 'document_distillations' }),
  skill('make-glossary', { artifact_type: 'glossary', scope: 'document', selector: 'document_chapters' }),
  skill('extract-quotes', { artifact_type: 'quote_set', selector: 'scope_blocks', document_selector: 'document_quotes' }),
  skill('make-mindmap', { artifact_type: null, selector: 'scope_blocks' }),
  skill('distil-chapter', { job_kind: 'distil_chapter', artifact_type: 'chapter_distillation' }),
  skill('assess-paper', { artifact_type: 'paper_assessment', scope: 'document', selector: 'paper_assessment' }),
];

describe('derive skills', () => {
  it('keeps only derive skills of the scope, ordered by what they make', () => {
    expect(deriveSkills(catalogue, 'chapter', 'book').map(deriveLabel)).toEqual(['Make a quiz', 'make-mindmap', 'Pick quotes']);
  });

  it('offers chapter skills with a document selector book-wide too', () => {
    expect(deriveSkills(catalogue, 'document', 'book').map((s) => s.name)).toEqual(['make-glossary', 'make-quiz', 'extract-quotes']);
  });

  it('offers paper skills on a paper only, alongside the genre-neutral ones', () => {
    expect(deriveSkills(catalogue, 'document', 'paper').map((s) => s.name)).toEqual([
      'assess-paper',
      'make-glossary',
      'make-quiz',
      'extract-quotes',
    ]);
    expect(deriveSkills(catalogue, 'document', 'article').map((s) => s.name)).not.toContain('assess-paper');
  });

  it('checks the distillation prerequisite against the input of the scope that runs', () => {
    const quotes = catalogue[2]!;
    expect(needsDistillation(quotes, 'chapter')).toBe(false);
    expect(needsDistillation(quotes, 'document')).toBe(true);
    expect(needsDistillation(catalogue[0]!, 'document')).toBe(true);
    expect(needsDistillation(catalogue[3]!, 'document')).toBe(false);
  });

  it('titles a derive job by its skill and scope', () => {
    expect(jobTitle({ kind: 'derive', skill: 'make-faq', anchor: 'ch02' })).toBe('Write an FAQ');
    expect(jobTitle({ kind: 'derive', skill: 'make-faq', anchor: null })).toBe('Write an FAQ · whole book');
    expect(jobTitle({ kind: 'distil_chapter', skill: 'distil-chapter', anchor: 'ch02' })).toBe('Distil chapter');
  });

  it('names an unknown skill by its package name', () => {
    expect(deriveLabel({ name: 'make-mindmap' })).toBe('make-mindmap');
  });
});

describe('enqueue', () => {
  it('sends a derive with its skill and without force', async () => {
    const { api, calls } = fakeApi({ 'POST jobs': () => ({ job: {}, deduplicated: false }) });
    await enqueue(api, { kind: 'derive', documentId: 'd1', anchor: 'ch02', skill: catalogue[0] });
    expect(calls).toEqual([{ method: 'POST', path: 'jobs', body: { kind: 'derive', document_id: 'd1', anchor: 'ch02', force: false, skill: 'make-quiz' } }]);
  });

  it('says a derive with no anchor is for the whole book', async () => {
    const { api } = fakeApi({ 'POST jobs': () => ({ job: {}, deduplicated: false }) });
    await enqueue(api, { kind: 'derive', documentId: 'd1', skill: catalogue[0] });
    expect(toast).toHaveBeenLastCalledWith('Queued: make a quiz for the whole book.', 'good');
  });

  it('forces a plain re-run', async () => {
    const { api, calls } = fakeApi({ 'POST jobs': () => ({ job: {}, deduplicated: false }) });
    await enqueue(api, { kind: 'brief', documentId: 'd1' });
    expect(calls[0]?.body).toEqual({ kind: 'brief', document_id: 'd1', anchor: null, force: true });
  });
});
