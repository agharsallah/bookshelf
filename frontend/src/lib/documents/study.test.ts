import { describe, expect, it } from 'vitest';
import type { ArtifactListItem } from '../api/types/artifacts';
import { availableMaterials, isStudyKind, studyHref } from './study';

const artifact = (type: string, review: string, anchor: string | null = null, version = 1) =>
  ({ id: `${type}-${review}-${version}`, type, review, anchor, version, superseded: false }) as unknown as ArtifactListItem;

describe('studyHref', () => {
  it('opens the brief and guide on their own pages and the rest on the study page', () => {
    expect(studyHref('meadows', 'brief')).toBe('/documents/meadows/brief');
    expect(studyHref('meadows', 'flashcards')).toBe('/documents/meadows/study/flashcards');
    expect(studyHref('meadows', 'quiz', 'ch03')).toBe('/documents/meadows/study/quiz?chapter=ch03');
  });
});

describe('availableMaterials', () => {
  it('lists what exists for the book in reading order, preferring approved versions and never rejected ones', () => {
    const found = availableMaterials('meadows', [
      artifact('flashcards', 'draft', null, 2),
      artifact('flashcards', 'approved', null, 1),
      artifact('book_brief', 'approved'),
      artifact('quiz', 'rejected'),
      artifact('faq', 'approved', 'ch03'),
    ]);
    expect(found.map((m) => [m.kind, m.standing, m.artifactId])).toEqual([
      ['brief', 'approved', 'book_brief-approved-1'],
      ['flashcards', 'approved', 'flashcards-approved-1'],
    ]);
  });

  it('lists a chapter’s own sets, never the book-only brief, guide or glossary', () => {
    const found = availableMaterials('meadows', [artifact('book_brief', 'approved', 'ch03'), artifact('faq', 'draft', 'ch03')], 'ch03');
    expect(found.map((m) => [m.kind, m.href, m.standing])).toEqual([['faq', '/documents/meadows/study/faq?chapter=ch03', 'draft']]);
  });
});

describe('isStudyKind', () => {
  it('knows the study page kinds only', () => {
    expect([isStudyKind('quiz'), isStudyKind('brief'), isStudyKind(undefined)]).toEqual([true, false, false]);
  });
});
