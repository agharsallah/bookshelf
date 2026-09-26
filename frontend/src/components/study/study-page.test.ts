import { describe, expect, it } from 'vitest';
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import { availableMaterials } from '../../lib/documents/study';
import { shortcutApplies } from './keys';
import { chapterParam, chapterScopes, emptyMessage, switcherItems } from './study-page';

const artifact = (type: ArtifactPublic['type'], anchor: string | null, review: ArtifactPublic['review'] = 'approved', id = `${type}-${anchor}`) =>
  ({ id, type, anchor, review, version: 1 }) as ArtifactPublic & { superseded: boolean };

describe('switcherItems', () => {
  const artifacts = [artifact('book_brief', null), artifact('faq', null), artifact('flashcards', null, 'draft')];

  it('lists what exists in shelf order and marks the current page', () => {
    const items = switcherItems('book', availableMaterials('book', artifacts), 'faq', null);
    expect(items.map((i) => [i.label, i.current, i.missing])).toEqual([
      ['Brief', false, false],
      ['Flashcards', false, false],
      ['FAQ', true, false],
    ]);
  });

  it('marks the brief or guide as the current page when the switcher sits on their pages', () => {
    const items = switcherItems('book', availableMaterials('book', artifacts), 'brief');
    expect(items.map((i) => [i.label, i.current, i.href])).toEqual([
      ['Brief', true, '/documents/book/brief'],
      ['Flashcards', false, '/documents/book/study/flashcards'],
      ['FAQ', false, '/documents/book/study/faq'],
    ]);
    expect(switcherItems('book', availableMaterials('book', artifacts), 'guide').find((i) => i.current)).toMatchObject({
      label: 'Book guide',
      missing: true,
      href: '/documents/book/guide',
    });
  });

  it('keeps the current page in the list when it has nothing yet', () => {
    const items = switcherItems('book', availableMaterials('book', artifacts), 'quiz', null);
    expect(items.find((i) => i.current)).toMatchObject({ kind: 'quiz', missing: true, href: '/documents/book/study/quiz' });
  });
});

describe('chapterScopes', () => {
  it('lists chapters with their own set of the type, in book order, rejected ones left out', () => {
    const artifacts = [artifact('faq', 'ch10'), artifact('faq', 'ch2'), artifact('faq', null), artifact('faq', 'ch3', 'rejected'), artifact('quiz', 'ch4')];
    expect(chapterScopes(artifacts, 'faq')).toEqual(['ch2', 'ch10']);
  });
});

it('reads a blank chapter parameter as the whole book', () => {
  expect(chapterParam(null)).toBeNull();
  expect(chapterParam(' ')).toBeNull();
  expect(chapterParam('ch03')).toBe('ch03');
});

it('says what is missing for the scope', () => {
  expect(emptyMessage('flashcards', null)).toBe('No flashcards yet for this book.');
  expect(emptyMessage('faq', 'ch03')).toBe('No FAQ yet for this chapter.');
});

describe('shortcutApplies', () => {
  const press = (key: string, tagName = 'BODY', extra = {}) => ({ key, target: { tagName } as unknown as EventTarget, altKey: false, ctrlKey: false, metaKey: false, ...extra });

  it('takes keys on the page but not while typing or with a modifier', () => {
    expect(shortcutApplies(press('k'))).toBe(true);
    expect(shortcutApplies(press('k', 'INPUT'))).toBe(false);
    expect(shortcutApplies(press('k', 'BODY', { metaKey: true }))).toBe(false);
  });

  it('leaves Space and Enter to a focused button, but not arrows', () => {
    expect(shortcutApplies(press(' ', 'BUTTON'))).toBe(false);
    expect(shortcutApplies(press('Enter', 'A'))).toBe(false);
    expect(shortcutApplies(press('ArrowRight', 'BUTTON'))).toBe(true);
  });
});
