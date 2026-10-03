import { describe, expect, it } from 'vitest';
import type { DocumentSummary, ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { DayPoint } from '../../lib/api/types/readerStats';
import { activeOn, alsoReading, dayOffset, dayPlan, heroStanding, marginNotes, markedWhen, pickHero, readShare, shortTitle, todayBook, trimPassage, unitName, weekDays } from './today';

const doc = (slug: string, over: Partial<DocumentSummary> = {}) =>
  ({ id: slug, slug, title: `Title ${slug}`, authors: [], status: 'linked', page_count: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over }) as unknown as DocumentSummary;
const unit = (anchor: string, from: number, to: number, meta: TreeNode['meta'] = {}) =>
  ({ anchor, kind: 'chapter', heading: `Heading ${anchor}`, page_from: from, page_to: to, meta, children: [] }) as unknown as TreeNode;
const at = (u: string, progress: number, updated_at: string): ReadingPosition => ({ unit: u, anchor: `${u}/p003`, progress, updated_at });

const units = [unit('fm01', 1, 4, { front_matter: true }), unit('ch01', 5, 24), unit('ch02', 25, 44)];

describe('pickHero', () => {
  it('puts the book read most recently in front, at the chapter you are in', () => {
    const older = todayBook(doc('a'), units, [at('ch01', 0.5, '2026-09-20T10:00:00Z')]);
    const newer = todayBook(doc('b'), units, [at('ch02', 0.4, '2026-09-25T10:00:00Z'), at('ch01', 1, '2026-09-24T10:00:00Z')]);
    const hero = pickHero([older, newer]);
    expect(hero.kind === 'continue' && [hero.book.doc.slug, hero.target.unit.anchor, hero.target.anchor]).toEqual(['b', 'ch02', 'ch02/p003']);
  });

  it('offers the newest readable book to start when nothing was read, skipping front matter', () => {
    const hero = pickHero([
      todayBook(doc('old', { created_at: '2026-01-01T00:00:00Z' }), units, []),
      todayBook(doc('new', { created_at: '2026-09-01T00:00:00Z' }), units, []),
      todayBook(doc('parsing', { created_at: '2026-09-10T00:00:00Z', status: 'parsing' }), [], []),
    ]);
    expect(hero.kind === 'start' && [hero.book.doc.slug, hero.unit.anchor]).toEqual(['new', 'ch01']);
  });

  it('says the book is finished when every chapter is read, waits when no book has chapters, and is empty without books', () => {
    const done = todayBook(doc('a'), units, [at('ch01', 1, '2026-09-20T10:00:00Z'), at('ch02', 1, '2026-09-21T10:00:00Z')]);
    expect(pickHero([done]).kind).toBe('finished');
    expect(pickHero([todayBook(doc('p', { status: 'parsing' }), [], [])]).kind).toBe('waiting');
    expect(pickHero([]).kind).toBe('empty');
  });
});

describe('alsoReading', () => {
  it('lists the other books part way through, most recent first, leaving out the hero, finished and unopened books', () => {
    const books = [
      todayBook(doc('hero'), units, [at('ch01', 0.3, '2026-09-29T10:00:00Z')]),
      todayBook(doc('older'), units, [at('ch01', 0.5, '2026-09-20T10:00:00Z')]),
      todayBook(doc('newer'), units, [at('ch02', 0.2, '2026-09-25T10:00:00Z')]),
      todayBook(doc('done'), units, [at('ch01', 1, '2026-09-26T10:00:00Z'), at('ch02', 1, '2026-09-27T10:00:00Z')]),
      todayBook(doc('unopened'), units, []),
    ];
    expect(alsoReading(books, pickHero(books)).map((b) => b.doc.slug)).toEqual(['newer', 'older']);
  });
});

describe('dayPlan', () => {
  const reading = todayBook(doc('a', { title: 'Deep Work: Rules for Focused Success' }), units, [at('ch02', 0.4, '2026-09-25T10:00:00Z')]);
  const finishedChapter = todayBook(doc('b', { title: 'Flow' }), units, [at('ch01', 1, '2026-09-25T10:00:00Z')]);

  it('puts the cards first, then the chapter to go back to, by the short title', () => {
    expect(dayPlan(pickHero([reading]), 22)).toBe('22 cards to review, then back to chapter 2 of Deep Work.');
    expect(dayPlan(pickHero([reading]), 1)).toBe('1 card to review, then back to chapter 2 of Deep Work.');
  });

  it('goes on to the next chapter once the last one is finished, and straight to reading with nothing due', () => {
    expect(dayPlan(pickHero([finishedChapter]), 0)).toBe('Nothing to review today. On to chapter 2 of Flow.');
    expect(dayPlan(pickHero([todayBook(doc('c', { title: 'Flow' }), units, [])]), null)).toBe('Nothing to review today. Start Flow.');
  });

  it('says what to do when there is no book to read', () => {
    expect(dayPlan(pickHero([]), 3)).toBe('3 cards to review.');
    expect(dayPlan(pickHero([]), 0)).toMatch(/^Add a book/);
    expect(dayPlan(pickHero([todayBook(doc('p', { status: 'parsing' }), [], [])]), 0)).toMatch(/still being prepared/);
  });
});

describe('names', () => {
  it('names a chapter by number and heading, front matter by heading', () => {
    expect([unitName(units[2]!), unitName(units[0]!)]).toEqual(['Chapter 2 · Heading ch02', 'Heading fm01']);
  });

  it('reads a sliver of progress as just started instead of 0%', () => {
    expect([readShare(0.004), readShare(0.4), readShare(0.4, 'read')]).toEqual(['Just started', '40% of the book', '40% read']);
  });

  it('drops a subtitle after a colon, and keeps a title that has none', () => {
    expect([shortTitle('Deep Work: Rules for Focused Success'), shortTitle('Flow'), shortTitle('Ratio 3:2')]).toEqual(['Deep Work', 'Flow', 'Ratio 3:2']);
  });
});

describe('weekDays', () => {
  const day = (date: string, read: number): DayPoint => ({ date, seconds: { read, listen: 60 }, notes: 0, reviews: 0, recalls: 0, moves: 0 });

  it('gives the seven days ending today, missing days as zero, scaled to the busiest', () => {
    const week = weekDays([day('2026-09-29', 540), day('2026-10-01', 240), day('2026-09-20', 9999)], '2026-10-01');
    expect(week.map((d) => [d.date, d.initial, d.seconds, d.height, d.today])).toEqual([
      ['2026-09-25', 'F', 0, 0, false],
      ['2026-09-26', 'S', 0, 0, false],
      ['2026-09-27', 'S', 0, 0, false],
      ['2026-09-28', 'M', 0, 0, false],
      ['2026-09-29', 'T', 600, 1, false],
      ['2026-09-30', 'W', 0, 0, false],
      ['2026-10-01', 'T', 300, 0.5, true],
    ]);
    expect(week[6]?.name).toBe('Thursday 1 October');
  });

  it('crosses a month and a year end', () => {
    expect(weekDays([], '2027-01-02').map((d) => d.date)).toEqual(['2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

describe('margins', () => {
  const note = (id: string, over: Partial<NoteDetail> = {}) =>
    ({ id, document_id: 'a', anchor: 'ch02/p003', raw: null, color: 'amber', created_at: '2026-09-24T10:00:00Z', detached: false, passage: `Passage ${id}`, ...over }) as NoteDetail;
  const books = { a: { slug: 'deep-work', title: 'Deep Work' } };

  it('keeps notes that still mark words in a book on the shelf, without the one shown', () => {
    const kept = marginNotes(
      [note('n1', { raw: '  my words  ' }), note('detached', { detached: true }), note('blank', { passage: '  ' }), note('gone', { document_id: 'z' }), note('shown')],
      books,
      'shown',
    );
    expect(kept).toEqual([{ id: 'n1', passage: 'Passage n1', raw: 'my words', color: 'amber', anchor: 'ch02/p003', created_at: '2026-09-24T10:00:00Z', book: books.a }]);
  });

  it('cuts a long passage at a word, and leaves a short one whole', () => {
    const long = `${'word '.repeat(200)}end`;
    const cut = trimPassage(long, 50);
    expect(cut.endsWith('word…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(51);
    expect(trimPassage(' a  short\npassage ')).toBe('a short passage');
  });

  it('keeps the same passage all day and moves to another on a different day', () => {
    expect(dayOffset('2026-10-01', 12)).toBe(dayOffset('2026-10-01', 12));
    const week = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => dayOffset(d, 12));
    expect(new Set(week).size).toBeGreaterThan(1);
    expect(week.every((o) => o >= 0 && o < 12)).toBe(true);
    expect(dayOffset('2026-10-01', 0)).toBe(0);
  });

  it('says when it was marked, in days and then as a date', () => {
    const now = '2026-10-01T12:00:00Z';
    expect([markedWhen('2026-10-01T08:00:00Z', now), markedWhen('2026-09-30T08:00:00Z', now), markedWhen('2026-09-24T08:00:00Z', now)]).toEqual([
      'Marked today',
      'Marked yesterday',
      'Marked 7 days ago',
    ]);
    expect(markedWhen('2026-06-02T12:00:00Z', now)).toBe('Marked on 2 June 2026');
  });
});

describe('activeOn', () => {
  const day = (date: string, over: Partial<DayPoint> = {}): DayPoint => ({ date, seconds: {}, notes: 0, reviews: 0, recalls: 0, moves: 0, ...over });

  it('counts a day with time or any action toward the streak', () => {
    expect(activeOn([day('2026-10-03', { seconds: { read: 60 } })], '2026-10-03')).toBe(true);
    expect(activeOn([day('2026-10-03', { reviews: 1 })], '2026-10-03')).toBe(true);
    expect(activeOn([day('2026-10-03')], '2026-10-03')).toBe(false);
    expect(activeOn([day('2026-10-02', { notes: 2 })], '2026-10-03')).toBe(false);
  });
});

describe('heroStanding', () => {
  it('describes the book to pick up, and nothing without one', () => {
    const book = todayBook(doc('a', { title: 'Deep Work: Rules for Focused Success' }), units, [at('ch01', 1, '2026-09-20T10:00:00Z'), at('ch02', 0.5, '2026-09-21T10:00:00Z')]);
    const standing = heroStanding(pickHero([book]));
    expect(standing).toMatchObject({ title: 'Deep Work', kind: 'continue', finished: 1, total: 2 });
    expect(heroStanding({ kind: 'empty' })).toBeNull();
  });
});
