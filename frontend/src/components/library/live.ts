/**
 * The library's script: filters apply as you type (debounced) over the books the
 * server already rendered, the order changes in place, tag chips toggle, the URL is
 * kept in step with history.replaceState, the view toggle swaps shelf and list, and
 * the "Add a book" dialog opens where invoker commands are missing. Without it, the
 * GET form, tag links and dialog still work on their own.
 */
import { bookFromData, type ShelfBook } from './book-data';
import { hasFilters, libraryHref, matchesFilters, noMatchMessage, parseFilters, resultSummary, type LibraryFilters } from './filters';
import { INGESTED_EVENT } from './ingest';
import { ADD_BOOK_DIALOG } from './live-ids';
import { parseSort, sortBy, type Sort } from './sort';
import { parseView, saveView, VIEWS, viewClass, type LibraryView } from './view';

export const TYPING_DELAY = 250;

interface Entry extends ShelfBook {
  el: HTMLElement;
}

/** Filters and order as the form currently says. */
export function formState(form: HTMLFormElement): { filters: LibraryFilters; sort: Sort } {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) if (typeof value === 'string') params.set(key, value);
  return { filters: parseFilters(params), sort: parseSort(params.get('sort')) };
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function wireFilters(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>('[data-filters]');
  if (!form) return;
  const tagInput = form.querySelector<HTMLInputElement>('input[name="tag"]');
  const lists: Entry[][] = [...root.querySelectorAll<HTMLElement>('[data-books]')].map((list) =>
    [...list.children].filter((el): el is HTMLElement => el instanceof HTMLElement).map((el) => ({ el, ...bookFromData(el.dataset) })),
  );
  const total = lists[0]?.length ?? 0;
  let sorted: Sort = formState(form).sort;

  const render = () => {
    const { filters, sort } = formState(form);
    let shown = 0;
    lists.forEach((entries, index) => {
      for (const entry of entries) {
        const match = matchesFilters(entry.book, filters);
        entry.el.hidden = !match;
        if (match && index === 0) shown += 1;
      }
      if (sort !== sorted) entries[0]?.el.parentElement?.append(...sortBy(entries, (e) => e.keys, sort).map((e) => e.el));
    });
    sorted = sort;

    const filtered = hasFilters(filters);
    const href = libraryHref(filters, sort);
    for (const el of root.querySelectorAll<HTMLElement>('[data-summary]')) el.textContent = resultSummary(shown, total, filtered);
    for (const el of root.querySelectorAll<HTMLAnchorElement>('[data-clear]')) {
      el.hidden = !filtered;
      el.href = libraryHref({ tag: null, status: null, author: null, q: null }, sort);
    }
    const none = root.querySelector<HTMLElement>('[data-no-match]');
    if (none) none.hidden = !(filtered && shown === 0 && total > 0);
    const noneText = root.querySelector<HTMLElement>('[data-no-match-text]');
    if (noneText) noneText.textContent = noMatchMessage(filters);
    for (const chip of root.querySelectorAll<HTMLAnchorElement>('a[data-tag]')) {
      const tag = chip.dataset.tag ?? null;
      const active = filters.tag === tag;
      if (active) chip.setAttribute('aria-current', 'true');
      else chip.removeAttribute('aria-current');
      chip.href = libraryHref({ ...filters, tag: active ? null : tag }, sort);
    }
    if (`${location.pathname}${location.search}` !== href) history.replaceState(history.state, '', href);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(render, TYPING_DELAY);
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
    const chip = target?.closest<HTMLAnchorElement>('a[data-tag]');
    const clear = target?.closest<HTMLAnchorElement>('a[data-clear]');
    if (!chip && !clear) return;
    if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    event.preventDefault();
    if (chip && tagInput) {
      tagInput.value = tagInput.value === chip.dataset.tag ? '' : (chip.dataset.tag ?? '');
    } else if (clear) {
      for (const name of ['q', 'author', 'status', 'tag']) {
        const field = form.elements.namedItem(name);
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = '';
      }
      form.querySelector<HTMLInputElement>('input[name="q"]')?.focus();
    }
    now();
  });
}

export function applyView(root: HTMLElement, view: LibraryView): void {
  for (const v of VIEWS) root.classList.toggle(viewClass(v), v === view);
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
}

function wireViews(root: HTMLElement): void {
  applyView(root, root.classList.contains(viewClass('list')) ? 'list' : 'shelf');
  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-view]') : null;
    if (!button) return;
    const view = parseView(button.dataset.view);
    applyView(root, view);
    saveView(storage(), view);
  });
}

function wireDialog(root: HTMLElement): void {
  const dialog = document.getElementById(ADD_BOOK_DIALOG);
  if (!(dialog instanceof HTMLDialogElement)) return;
  // Invoker commands open the dialog natively; elsewhere, open it from here.
  if (!('command' in HTMLButtonElement.prototype)) {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-add-book]')) {
      button.addEventListener('click', () => dialog.showModal());
    }
  }
  let added = false;
  window.addEventListener(INGESTED_EVENT, () => (added = true));
  dialog.addEventListener('close', () => {
    if (added) location.reload();
  });
}

export function initLibrary(root: HTMLElement): void {
  wireFilters(root);
  wireViews(root);
  wireDialog(root);
}
