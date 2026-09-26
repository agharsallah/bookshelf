import { describe, expect, it } from 'vitest';
import type { DocumentSummary, ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import type { AvailableMaterial } from '../../lib/documents/study';
import { deskBook, pagesChart, pickHero, readShare, splitMaterials, studyGroups, unitName, whereYouAre } from './desk';

const doc = (slug: string, over: Partial<DocumentSummary> = {}) =>
  ({ id: slug, slug, title: `Title ${slug}`, authors: [], status: 'linked', page_count: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over }) as unknown as DocumentSummary;
const unit = (anchor: string, from: number, to: number, meta: TreeNode['meta'] = {}) =>
  ({ anchor, kind: 'chapter', heading: `Heading ${anchor}`, page_from: from, page_to: to, meta, children: [] }) as unknown as TreeNode;
const at = (u: string, progress: number, updated_at: string): ReadingPosition => ({ unit: u, anchor: `${u}/p003`, progress, updated_at });
const material = (kind: AvailableMaterial['kind']) => ({ kind, label: kind, href: `/x/${kind}`, standing: 'approved' }) as AvailableMaterial;

const units = [unit('fm01', 1, 4, { front_matter: true }), unit('ch01', 5, 24), unit('ch02', 25, 44)];

describe('pickHero', () => {
  it('puts the book read most recently in front, at the chapter you are in', () => {
    const older = deskBook(doc('a'), units, [at('ch01', 0.5, '2026-09-20T10:00:00Z')]);
    const newer = deskBook(doc('b'), units, [at('ch02', 0.4, '2026-09-25T10:00:00Z'), at('ch01', 1, '2026-09-24T10:00:00Z')]);
    const hero = pickHero([older, newer]);
    expect(hero.kind).toBe('continue');
    if (hero.kind !== 'continue') return;
    expect([hero.book.doc.slug, hero.target.unit.anchor, hero.target.anchor]).toEqual(['b', 'ch02', 'ch02/p003']);
  });

  it('offers the newest readable book to start when nothing was read, skipping front matter', () => {
    const hero = pickHero([
      deskBook(doc('old', { created_at: '2026-01-01T00:00:00Z' }), units, []),
      deskBook(doc('new', { created_at: '2026-09-01T00:00:00Z' }), units, []),
      deskBook(doc('parsing', { created_at: '2026-09-10T00:00:00Z', status: 'parsing' }), [], []),
    ]);
    expect(hero.kind === 'start' && [hero.book.doc.slug, hero.unit.anchor]).toEqual(['new', 'ch01']);
  });

  it('says the book is finished when every chapter is read, waits when no book has chapters, and is empty without books', () => {
    const done = deskBook(doc('a'), units, [at('ch01', 1, '2026-09-20T10:00:00Z'), at('ch02', 1, '2026-09-21T10:00:00Z')]);
    expect(pickHero([done]).kind).toBe('finished');
    expect(pickHero([deskBook(doc('p', { status: 'parsing' }), [], [])]).kind).toBe('waiting');
    expect(pickHero([]).kind).toBe('empty');
  });
});

describe('where you are', () => {
  it('names the chapter by number and heading with how far you got, front matter by heading', () => {
    expect(whereYouAre({ unit: units[2]!, anchor: 'ch02/p003', progress: 0.4, kind: 'continue' })).toBe('Chapter 2 · Heading ch02, 40%');
    expect(whereYouAre({ unit: units[1]!, anchor: 'ch01', progress: 0, kind: 'next' })).toBe('Chapter 1 · Heading ch01');
    expect(unitName(units[0]!)).toBe('Heading fm01');
  });

  it('reads a sliver of progress as just started instead of 0%', () => {
    expect([readShare(0.004), readShare(0.4), readShare(0.4, 'read')]).toEqual(['Just started', '40% of the book', '40% read']);
  });
});

describe('studyGroups', () => {
  it('groups material by book, only books that have some, most recently read first', () => {
    const groups = studyGroups([
      deskBook(doc('a'), units, [at('ch01', 0.2, '2026-09-20T10:00:00Z')], [material('brief')]),
      deskBook(doc('none'), units, [], []),
      deskBook(doc('b'), units, [at('ch01', 0.2, '2026-09-25T10:00:00Z')], [material('guide'), material('quiz')]),
    ]);
    expect(groups.map((g) => [g.book.doc.slug, g.materials.map((m) => m.kind)])).toEqual([
      ['b', ['guide', 'quiz']],
      ['a', ['brief']],
    ]);
  });

  it('separates what you read from what you practise with', () => {
    const { read, practise } = splitMaterials(['brief', 'guide', 'flashcards', 'quiz', 'faq', 'quotes', 'glossary'].map((k) => material(k as AvailableMaterial['kind'])));
    expect([read.map((m) => m.kind), practise.map((m) => m.kind)]).toEqual([
      ['brief', 'guide', 'quotes', 'glossary'],
      ['flashcards', 'quiz', 'faq'],
    ]);
  });
});

describe('pagesChart', () => {
  it('counts pages read against pages on the shelf, bars on the longest book’s scale', () => {
    const long = deskBook(doc('long', { page_count: 200 }), [unit('ch01', 1, 100), unit('ch02', 101, 200)], [at('ch01', 1, '2026-09-25T10:00:00Z')]);
    const short = deskBook(doc('short', { page_count: null }), [unit('ch01', 1, 50)], []);
    const unparsed = deskBook(doc('unparsed', { page_count: 300, status: 'parsing' }), [], []);
    const chart = pagesChart([short, long, unparsed]);
    expect(chart.bars.map((b) => [b.slug, b.read, b.pages, b.width, b.share])).toEqual([
      ['long', 100, 200, 1, 0.5],
      ['short', 0, 50, 0.25, 0],
    ]);
    expect([chart.read, chart.total]).toEqual([100, 250]);
  });
});
