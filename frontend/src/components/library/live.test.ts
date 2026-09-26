// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookAttributes } from './book-data';
import { initLibrary, TYPING_DELAY } from './live';
import { sortKeys } from './sort';
import { summary } from './test-books';
import { VIEW_STORAGE_KEY } from './view';

const books = [
  summary('systems', { title: 'Thinking in Systems', authors: ['Donella Meadows'], tags: ['systems'], created_at: '2026-01-01' }),
  summary('flow', { title: 'The Principles of Flow', authors: ['Donald Reinertsen'], tags: ['flow'], created_at: '2026-02-01' }),
];

function item(doc: (typeof books)[number]): string {
  const attrs = Object.entries(bookAttributes(doc, sortKeys(doc, null)))
    .map(([k, v]) => `${k}='${v}'`)
    .join(' ');
  return `<li ${attrs}>${doc.title}</li>`;
}

function mount(): HTMLElement {
  document.body.innerHTML = `
    <div class="library view-shelf" data-library>
      <form data-filters>
        <input type="search" name="q" value="" />
        <input name="author" value="" />
        <select name="sort"><option value="read" selected>Recently read</option><option value="title">Title</option></select>
        <input type="hidden" name="tag" value="" />
        <button type="submit" data-apply>Filter</button>
      </form>
      <a href="/library?tag=flow" data-tag="flow">flow</a>
      <span data-summary>2 books</span>
      <a href="/library" data-clear hidden>Clear filters</a>
      <div data-no-match hidden><p data-no-match-text></p></div>
      <button type="button" data-view="shelf" aria-pressed="true">Shelf</button>
      <button type="button" data-view="list" aria-pressed="false">List</button>
      <ul data-books>${books.map(item).join('')}</ul>
      <ol data-books>${books.map(item).join('')}</ol>
    </div>`;
  const root = document.querySelector<HTMLElement>('[data-library]');
  if (!root) throw new Error('no root');
  initLibrary(root);
  return root;
}

const visible = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('ul[data-books] > li')].filter((li) => !li.hidden).map((li) => li.dataset.book);
const type = (root: HTMLElement, name: string, value: string) => {
  const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) throw new Error(name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, '', '/library');
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('initLibrary', () => {
  it('hides the Filter button, since filters apply as you type', () => {
    const root = mount();
    expect(root.querySelector<HTMLButtonElement>('[data-apply]')?.hidden).toBe(true);
  });

  it('filters after a pause in typing and keeps the URL shareable', () => {
    const root = mount();
    type(root, 'q', 'system');
    expect(visible(root)).toEqual(['systems', 'flow']);
    vi.advanceTimersByTime(TYPING_DELAY);
    expect(visible(root)).toEqual(['systems']);
    expect(location.search).toBe('?q=system');
    expect(root.querySelector('[data-summary]')?.textContent).toBe('1 of 2 books');
    expect(root.querySelector<HTMLElement>('[data-clear]')?.hidden).toBe(false);
  });

  it('says so when nothing matches, and clears the filters in place', () => {
    const root = mount();
    type(root, 'q', 'zebra');
    vi.advanceTimersByTime(TYPING_DELAY);
    expect(root.querySelector<HTMLElement>('[data-no-match]')?.hidden).toBe(false);
    expect(root.querySelector('[data-no-match-text]')?.textContent).toBe('No books match “zebra”.');

    root.querySelector<HTMLAnchorElement>('[data-clear]')?.click();
    expect(visible(root)).toEqual(['systems', 'flow']);
    expect(location.search).toBe('');
    expect(root.querySelector<HTMLElement>('[data-no-match]')?.hidden).toBe(true);
  });

  it('toggles a tag chip on and off', () => {
    const root = mount();
    const chip = root.querySelector<HTMLAnchorElement>('a[data-tag="flow"]');
    chip?.click();
    expect(visible(root)).toEqual(['flow']);
    expect(chip?.getAttribute('aria-current')).toBe('true');
    expect(location.search).toBe('?tag=flow');
    chip?.click();
    expect(visible(root)).toEqual(['systems', 'flow']);
    expect(chip?.hasAttribute('aria-current')).toBe(false);
  });

  it('re-orders both views when another order is picked', () => {
    const root = mount();
    const select = root.querySelector<HTMLSelectElement>('select[name="sort"]');
    if (!select) throw new Error('no select');
    select.value = 'title';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    for (const list of root.querySelectorAll('[data-books]')) {
      expect([...list.children].map((li) => (li as HTMLElement).dataset.book)).toEqual(['flow', 'systems']);
    }
    expect(location.search).toBe('?sort=title');
  });

  it('switches to the list and remembers it', () => {
    const root = mount();
    root.querySelector<HTMLButtonElement>('[data-view="list"]')?.click();
    expect(root.classList.contains('view-list')).toBe(true);
    expect(root.classList.contains('view-shelf')).toBe(false);
    expect(root.querySelector('[data-view="list"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe('list');
  });
});
