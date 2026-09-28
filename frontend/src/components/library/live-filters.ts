/**
 * Filtering and arranging the rendered books in place. Filters apply as you type
 * (debounced) or at once for a pick; tag chips, the overview's facet buckets and the
 * removable filter chips toggle the form's fields; the order and the grouping move
 * the elements themselves (`arrange.ts`), so what is read and tabbed through matches
 * what is seen. The URL is kept in step with history.replaceState.
 */
import { arrange, type Divider } from './arrange';
import { bookFromData, type ShelfBook } from './book-data';
import { parseDimension, type Dimension } from './facets';
import {
  activeFilters,
  FILTER_KEYS,
  hasFilters,
  libraryHref,
  matchesFilters,
  NO_FILTERS,
  noMatchMessage,
  parseFilters,
  resultSummary,
  type LibraryFilters,
} from './filters';
import { moveShelf } from './live-motion';
import { parseSort, stickerFor, type Sort, type Sticker } from './sort';

export const TYPING_DELAY = 250;

interface BookEntry extends ShelfBook {
  el: HTMLElement;
}

interface DividerEntry extends Divider {
  el: HTMLElement;
}

interface BookList {
  el: HTMLElement;
  books: BookEntry[];
  dividers: DividerEntry[];
}

/** Filters and order as the form currently says. */
export function formState(form: HTMLFormElement): { filters: LibraryFilters; sort: Sort } {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) if (typeof value === 'string') params.set(key, value);
  return { filters: parseFilters(params), sort: parseSort(params.get('sort')) };
}

/** The dimension dyeing the books, and the one they are grouped by (null when not grouped). */
export function displayState(root: HTMLElement): { by: Dimension; group: Dimension | null } {
  const by = parseDimension([...root.classList].find((c) => c.startsWith('by-'))?.slice(3));
  return { by, group: root.classList.contains('group-on') ? by : null };
}

export const bucketOfBook = (entry: ShelfBook, dimension: Dimension): string =>
  dimension === 'kind' ? entry.book.genre : entry.book[dimension];

function readLists(root: HTMLElement): BookList[] {
  return [...root.querySelectorAll<HTMLElement>('[data-books]')].map((el) => {
    const children = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
    return {
      el,
      books: children.filter((c) => c.dataset.book !== undefined).map((c) => ({ el: c, ...bookFromData(c.dataset) })),
      dividers: children
        .filter((c) => c.dataset.divider !== undefined)
        .map((c) => ({ el: c, dimension: c.dataset.divider ?? '', bucket: c.dataset.bucket ?? '', index: Number(c.dataset.index ?? 0) })),
    };
  });
}

function setField(form: HTMLFormElement, name: string, value: string): void {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
}

function fieldValue(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement || field instanceof HTMLSelectElement ? field.value : '';
}

const svgNS = 'http://www.w3.org/2000/svg';

function chip(key: string, label: string, remove: string, href: string): HTMLLIElement {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = href;
  a.dataset.remove = key;
  a.setAttribute('aria-label', remove);
  a.textContent = label;
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M4 4l8 8m0-8l-8 8');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  a.append(svg);
  li.append(a);
  return li;
}

export interface RenderOptions {
  /** A display change (view, dye, grouping) to make in the same step, so it animates with the books. */
  change?: () => void;
  /** Animate even when nothing moves; false never animates (the first render). */
  animate?: boolean;
}

export type Render = (options?: RenderOptions) => void;

/** Wire the filters; the returned `render` re-applies them (and any display change). */
export function wireFilters(root: HTMLElement): Render | null {
  const form = root.querySelector<HTMLFormElement>('[data-filters]');
  if (!form) return null;
  const lists = readLists(root);
  const total = lists[0]?.books.length ?? 0;
  // The server renders in this order, ungrouped.
  let arranged = `${formState(form).sort}|`;
  let chips = '';

  const updateControls = (filters: LibraryFilters, sort: Sort, shown: number) => {
    const filtered = hasFilters(filters);
    const href = libraryHref(filters, sort);
    for (const el of root.querySelectorAll<HTMLElement>('[data-summary]')) el.textContent = resultSummary(shown, total, filtered);
    for (const el of root.querySelectorAll<HTMLAnchorElement>('a[data-clear]')) {
      el.hidden = !filtered;
      el.href = libraryHref(NO_FILTERS, sort);
    }
    const none = root.querySelector<HTMLElement>('[data-no-match]');
    if (none) none.hidden = !(filtered && shown === 0 && total > 0);
    const noneText = root.querySelector<HTMLElement>('[data-no-match-text]');
    if (noneText) noneText.textContent = noMatchMessage(filters);

    for (const el of root.querySelectorAll<HTMLAnchorElement>('a[data-tag]')) {
      const tag = el.dataset.tag ?? null;
      const active = filters.tag === tag;
      if (active) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
      el.href = libraryHref({ ...filters, tag: active ? null : tag }, sort);
    }
    for (const el of root.querySelectorAll<HTMLAnchorElement>('a[data-facet-filter]')) {
      const key = el.dataset.facetFilter as keyof LibraryFilters;
      const active = filters[key] === el.dataset.value;
      if (active) el.setAttribute('aria-current', 'true');
      else el.removeAttribute('aria-current');
      el.href = libraryHref({ ...filters, [key]: active ? null : (el.dataset.value ?? null) }, sort);
    }
    for (const facet of root.querySelectorAll<HTMLElement>('[data-facet]')) {
      const current = facet.querySelector<HTMLAnchorElement>('a[data-facet-filter][aria-current]');
      facet.toggleAttribute('data-filtered', current !== null);
      for (const seg of facet.querySelectorAll<HTMLElement>('[data-segment]')) {
        seg.toggleAttribute('data-active', seg.dataset.segment === current?.dataset.value);
      }
    }

    const active = activeFilters(filters);
    const signature = JSON.stringify(active);
    const holder = root.querySelector<HTMLElement>('[data-active-filters]');
    if (holder && signature !== chips) {
      holder.replaceChildren(...active.map((f) => chip(f.key, f.label, f.remove, libraryHref({ ...filters, [f.key]: null }, sort))));
      chips = signature;
    }

    const sticker: Sticker = stickerFor(sort);
    for (const name of ['year', 'progress', 'length'] as const) root.classList.toggle(`sticker-${name}`, name === sticker);
    if (`${location.pathname}${location.search}` !== href) history.replaceState(history.state, '', href);
  };

  const render: Render = ({ change, animate } = {}) => {
    const before = formState(form);
    const matchNow = (entry: BookEntry) => matchesFilters(entry.book, before.filters);
    const first = lists[0]?.books ?? [];
    const willChange = first.some((entry) => entry.el.hidden === matchNow(entry)) || arranged !== `${before.sort}|${displayState(root).group ?? ''}`;

    const apply = () => {
      change?.();
      const { filters, sort } = formState(form);
      const { group } = displayState(root);
      const key = `${sort}|${group ?? ''}`;
      let shown = 0;
      lists.forEach((list, index) => {
        for (const entry of list.books) {
          const match = matchesFilters(entry.book, filters);
          entry.el.hidden = !match;
          if (match && index === 0) shown += 1;
        }
        for (const divider of list.dividers) {
          const count = list.books.filter((b) => !b.el.hidden && bucketOfBook(b, divider.dimension as Dimension) === divider.bucket).length;
          divider.el.hidden = count === 0;
          const counter = divider.el.querySelector('[data-divider-count]');
          if (counter) counter.textContent = String(count);
        }
        if (key !== arranged) {
          list.el.append(...arrange(list.books, list.dividers, (b) => b.keys, bucketOfBook, sort, group).map((item) => item.el));
        }
      });
      arranged = key;
      updateControls(filters, sort, shown);
    };

    if (animate === false || (!change && !willChange && !animate)) apply();
    else moveShelf(root, apply);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => render(), TYPING_DELAY);
  };
  const now = () => {
    clearTimeout(timer);
    render();
  };

  form.querySelector<HTMLElement>('[data-apply]')?.setAttribute('hidden', '');
  // Typing waits for a pause; a picked option applies at once.
  form.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLSelectElement)) later();
  });
  form.addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement) now();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    now();
  });

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    const segment = target.closest<HTMLElement>('[data-segment]');
    const link =
      target.closest<HTMLAnchorElement>('a[data-tag], a[data-facet-filter], a[data-remove], a[data-clear]') ??
      segment?.closest('[data-facet]')?.querySelector<HTMLAnchorElement>(`a[data-facet-filter][data-value="${CSS.escape(segment.dataset.segment ?? '')}"]`) ??
      null;
    if (!link) return;
    event.preventDefault();
    if (link.dataset.tag !== undefined) {
      setField(form, 'tag', fieldValue(form, 'tag') === link.dataset.tag ? '' : link.dataset.tag);
    } else if (link.dataset.facetFilter) {
      const name = link.dataset.facetFilter;
      setField(form, name, fieldValue(form, name) === link.dataset.value ? '' : (link.dataset.value ?? ''));
    } else if (link.dataset.remove) {
      setField(form, link.dataset.remove, '');
      form.querySelector<HTMLInputElement>('input[name="q"]')?.focus();
    } else {
      for (const name of FILTER_KEYS) setField(form, name, '');
      form.querySelector<HTMLInputElement>('input[name="q"]')?.focus();
    }
    now();
  });

  render({ animate: false });
  return render;
}
