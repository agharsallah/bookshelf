// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookAttributes } from './book-data';
import { bucketsOf, NO_THEME } from './facets';
import { initLibrary, TYPING_DELAY } from './live';
import { DWELL } from './live-lectern';
import { NOT_READ } from './progress';
import { sortKeys } from './sort';
import { card, summary } from './test-books';
import { PREFS } from './view';

const books = [
  summary('systems', {
    title: 'Thinking in Systems',
    authors: ['Donella Meadows'],
    tags: ['systems'],
    created_at: '2026-01-01',
    catalogue: card('Systems thinking'),
  }),
  summary('flow', { title: 'The Principles of Flow', authors: ['Donald Reinertsen'], tags: ['flow'], created_at: '2026-02-01', genre: 'paper' }),
];

function item(doc: (typeof books)[number], withSpine: boolean): string {
  const attrs = Object.entries(bookAttributes(doc, bucketsOf(doc, NOT_READ), sortKeys(doc, NOT_READ)))
    .map(([k, v]) => `${k}='${v}'`)
    .join(' ');
  const inner = withSpine ? `<a href="/documents/${doc.slug}" data-spine>${doc.title}</a>` : doc.title;
  return `<li ${attrs}>${inner}</li>`;
}

const divider = (dimension: string, bucket: string, index: number) =>
  `<li data-divider="${dimension}" data-bucket="${bucket}" data-index="${index}"><span data-divider-count>0</span></li>`;
const dividers = [divider('kind', 'book', 0), divider('kind', 'paper', 1), divider('theme', 'Systems thinking', 0), divider('theme', NO_THEME, 1)].join('');

function mount(): HTMLElement {
  document.body.innerHTML = `
    <div class="library view-shelf by-kind group-off sticker-year" data-library>
      <form data-filters>
        <input type="search" name="q" value="" />
        <select name="sort"><option value="read" selected>Recently read</option><option value="title">Title</option><option value="progress">Most read</option></select>
        <input type="hidden" name="genre" value="" />
        <input type="hidden" name="theme" value="" />
        <input type="hidden" name="tag" value="" />
        <button type="submit" data-apply>Filter</button>
      </form>
      <div data-facet="kind">
        <span data-segment="paper"></span>
        <a href="/library?genre=paper" data-facet-filter="genre" data-value="paper">Papers</a>
      </div>
      <button type="button" data-by="kind" aria-pressed="false">Kind</button>
      <button type="button" data-by="theme" aria-pressed="false">Theme</button>
      <button type="button" data-group aria-pressed="false">Group</button>
      <a href="/library?tag=flow" data-tag="flow">flow</a>
      <p data-summary>2 books</p>
      <ul data-active-filters></ul>
      <a href="/library" data-clear hidden>Clear all</a>
      <div data-no-match hidden><p data-no-match-text></p></div>
      <button type="button" data-view="shelf" aria-pressed="true">Shelf</button>
      <button type="button" data-view="list" aria-pressed="false">List</button>
      <div class="shelf-view">
        <ul data-books>${books.map((b) => item(b, true)).join('')}${dividers}</ul>
        <aside><div data-lectern-slot data-book="systems"></div><p data-lectern-status></p></aside>
        ${books.map((b) => `<template data-lectern-for="${b.slug}"><h2>${b.title} on the lectern</h2></template>`).join('')}
      </div>
      <ol data-books>${books.map((b) => item(b, false)).join('')}${dividers}</ol>
    </div>`;
  const root = document.querySelector<HTMLElement>('[data-library]');
  if (!root) throw new Error('no root');
  initLibrary(root);
  return root;
}

const shelf = (root: HTMLElement) => root.querySelector<HTMLElement>('ul[data-books]') as HTMLElement;
const visible = (root: HTMLElement) =>
  [...shelf(root).querySelectorAll<HTMLElement>(':scope > [data-book]')].filter((li) => !li.hidden).map((li) => li.dataset.book);
/** The shelf's order as a reader meets it: books, and the dividers in use (`|bucket`). */
const order = (root: HTMLElement, dimension: string) =>
  [...shelf(root).children]
    .map((el) => el as HTMLElement)
    .filter((el) => !el.hidden && (el.dataset.book !== undefined || el.dataset.divider === dimension))
    .map((el) => el.dataset.book ?? `|${el.dataset.bucket}`);
const type = (root: HTMLElement, name: string, value: string) => {
  const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error(name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const pick = (root: HTMLElement, value: string) => {
  const select = root.querySelector<HTMLSelectElement>('select[name="sort"]');
  if (!select) throw new Error('no select');
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};
const click = (el: Element | null) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  el?.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, '', '/library');
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('filters', () => {
  it('hide the Filter button and show the script-only controls, since filters apply as you type', () => {
    const root = mount();
    expect(root.querySelector<HTMLButtonElement>('[data-apply]')?.hidden).toBe(true);
    expect(root.hasAttribute('data-live')).toBe(true);
  });

  it('apply after a pause in typing, match authors too, and keep the URL shareable', () => {
    const root = mount();
    type(root, 'q', 'reinertsen');
    expect(visible(root)).toEqual(['systems', 'flow']);
    vi.advanceTimersByTime(TYPING_DELAY);
    expect(visible(root)).toEqual(['flow']);
    expect(location.search).toBe('?q=reinertsen');
    expect(root.querySelector('[data-summary]')?.textContent).toBe('1 of 2 books');
    expect(root.querySelector('[data-active-filters] a')?.getAttribute('aria-label')).toBe('Remove the filter “reinertsen”');
  });

  it('say so when nothing matches, and clear in place', () => {
    const root = mount();
    type(root, 'q', 'zebra');
    vi.advanceTimersByTime(TYPING_DELAY);
    expect(root.querySelector<HTMLElement>('[data-no-match]')?.hidden).toBe(false);
    expect(root.querySelector('[data-no-match-text]')?.textContent).toBe('No books match “zebra”.');

    click(root.querySelector('[data-clear]'));
    expect(visible(root)).toEqual(['systems', 'flow']);
    expect(location.search).toBe('');
    expect(root.querySelector<HTMLElement>('[data-no-match]')?.hidden).toBe(true);
  });

  it('toggle a tag chip on and off', () => {
    const root = mount();
    const chip = root.querySelector<HTMLAnchorElement>('a[data-tag="flow"]');
    click(chip);
    expect(visible(root)).toEqual(['flow']);
    expect(chip?.getAttribute('aria-current')).toBe('true');
    click(chip);
    expect(visible(root)).toEqual(['systems', 'flow']);
    expect(chip?.hasAttribute('aria-current')).toBe(false);
  });

  it('filter to a bucket from its legend or its bar segment, and drop it from its chip', () => {
    const root = mount();
    click(root.querySelector('[data-segment="paper"]'));
    expect(visible(root)).toEqual(['flow']);
    expect(location.search).toBe('?genre=paper');
    expect(root.querySelector('a[data-facet-filter]')?.getAttribute('aria-current')).toBe('true');
    expect(root.querySelector('[data-facet="kind"]')?.hasAttribute('data-filtered')).toBe(true);

    click(root.querySelector('a[data-remove="genre"]'));
    expect(visible(root)).toEqual(['systems', 'flow']);
    expect(root.querySelectorAll('[data-active-filters] li')).toHaveLength(0);
  });
});

describe('arranging', () => {
  it('re-orders both views when another order is picked, and the stickers follow it', () => {
    const root = mount();
    pick(root, 'title');
    for (const list of root.querySelectorAll('[data-books]')) {
      expect([...list.querySelectorAll<HTMLElement>(':scope > [data-book]')].map((li) => li.dataset.book)).toEqual(['flow', 'systems']);
    }
    expect(location.search).toBe('?sort=title');
    pick(root, 'progress');
    expect(root.classList.contains('sticker-progress')).toBe(true);
    expect(root.classList.contains('sticker-year')).toBe(false);
  });

  it('dyes by another dimension and groups by it behind counted dividers, remembering both', () => {
    const root = mount();
    click(root.querySelector('button[data-by="theme"]'));
    expect(root.classList.contains('by-theme')).toBe(true);
    expect(root.querySelector('button[data-by="theme"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(PREFS.by.key)).toBe('theme');

    click(root.querySelector('button[data-group]'));
    expect(root.classList.contains('group-on')).toBe(true);
    expect(order(root, 'theme')).toEqual(['|Systems thinking', 'systems', `|${NO_THEME}`, 'flow']);
    expect(shelf(root).querySelector('[data-bucket="Systems thinking"] [data-divider-count]')?.textContent).toBe('1');
    expect(localStorage.getItem(PREFS.group.key)).toBe('on');

    type(root, 'q', 'flow');
    vi.advanceTimersByTime(TYPING_DELAY);
    expect(order(root, 'theme')).toEqual([`|${NO_THEME}`, 'flow']); // an emptied group's divider goes
  });

  it('switches to the list and remembers it', () => {
    const root = mount();
    click(root.querySelector('[data-view="list"]'));
    expect(root.classList.contains('view-list')).toBe(true);
    expect(root.classList.contains('view-shelf')).toBe(false);
    expect(root.querySelector('[data-view="list"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(PREFS.view.key)).toBe('list');
  });

  it('lights the books of the bucket under the pointer and fades the rest', () => {
    const root = mount();
    root.querySelector('a[data-facet-filter]')?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    const dimmed = [...shelf(root).querySelectorAll<HTMLElement>('[data-book]')].map((li) => li.hasAttribute('data-dimmed'));
    expect(dimmed).toEqual([true, false]);
    root.dispatchEvent(new Event('pointerleave'));
    expect(shelf(root).querySelector('[data-dimmed]')).toBeNull();
  });
});

describe('the lectern', () => {
  const over = (el: Element | null, type = 'pointerover') => el?.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse' }));
  const lectern = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-lectern-slot]');

  it('shows the spine the pointer rests on, not the ones it sweeps past', () => {
    const root = mount();
    const flow = root.querySelector('[data-book="flow"] a[data-spine]');
    const systems = root.querySelector('[data-book="systems"] a[data-spine]');

    over(flow);
    over(flow, 'pointerout');
    over(systems);
    vi.advanceTimersByTime(DWELL - 1);
    expect(lectern(root)?.dataset.book).toBe('systems'); // still the book it opened on

    over(flow);
    vi.advanceTimersByTime(DWELL);
    expect(lectern(root)?.textContent).toBe('The Principles of Flow on the lectern');
    expect(flow?.getAttribute('aria-current')).toBe('true');
    expect(systems?.hasAttribute('aria-current')).toBe(false);
    expect(root.querySelector('[data-lectern-status]')?.textContent).toBe('The Principles of Flow, on the lectern');
  });

  it('leaves a click on a spine to open the book', () => {
    const root = mount();
    expect(click(root.querySelector('[data-book="flow"] a[data-spine]')).defaultPrevented).toBe(false);
  });

  it('shows a focused spine at once, and walks along the shelf with the arrow keys', () => {
    const root = mount();
    const first = root.querySelector<HTMLAnchorElement>('[data-book="systems"] a[data-spine]');
    first?.focus();
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement?.closest<HTMLElement>('[data-book]')?.dataset.book).toBe('flow');
    expect(lectern(root)?.dataset.book).toBe('flow');
  });
});
