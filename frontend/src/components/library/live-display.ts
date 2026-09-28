/**
 * The display choices: shelf or list, the dimension that dyes the books, grouping by
 * it. Each is a class on the library (`view.ts`), remembered in localStorage, and made
 * inside `render` so the books animate to their new places. Pointing at a bucket in the
 * overview lights its books and fades the rest (the spotlight).
 */
import { DIMENSIONS, type Dimension } from './facets';
import type { Render } from './live-filters';
import { parsePref, PREFS, prefClass, savePref, type PrefName, type PrefValue } from './view';

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The button attribute that picks each choice. */
const BUTTONS: Record<PrefName, string> = { view: 'data-view', by: 'data-by', group: 'data-group' };

export function currentPref<N extends PrefName>(root: HTMLElement, name: N): PrefValue<N> {
  const value = (PREFS[name].values as readonly string[]).find((v) => root.classList.contains(`${name}-${v}`));
  return parsePref(name, value);
}

/** Set a choice's class and the pressed state of its buttons. */
export function applyPref<N extends PrefName>(root: HTMLElement, name: N, value: PrefValue<N>): void {
  for (const v of PREFS[name].values) root.classList.toggle(prefClass(name, v as PrefValue<N>), v === value);
  syncButtons(root);
}

function syncButtons(root: HTMLElement): void {
  const view = currentPref(root, 'view');
  const by = currentPref(root, 'by');
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-by]')) b.setAttribute('aria-pressed', String(b.dataset.by === by));
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-group]')) {
    b.setAttribute('aria-pressed', String(currentPref(root, 'group') === 'on'));
  }
}

function wireSpotlight(root: HTMLElement): void {
  const books = () => root.querySelectorAll<HTMLElement>('[data-book]');
  const clear = () => {
    for (const el of books()) delete el.dataset.dimmed;
    for (const el of root.querySelectorAll<HTMLElement>('[data-segment][data-lit]')) delete el.dataset.lit;
  };
  const light = (target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('a[data-facet-filter], [data-segment]') : null;
    if (!el) return clear();
    const facet = el.closest<HTMLElement>('[data-facet]');
    const dimension = facet?.dataset.facet as Dimension | undefined;
    const value = el.dataset.value ?? el.dataset.segment;
    if (!dimension || !DIMENSIONS.includes(dimension) || !value) return clear();
    const attribute = dimension === 'kind' ? 'genre' : dimension;
    for (const book of books()) book.toggleAttribute('data-dimmed', book.dataset[attribute] !== value);
    for (const seg of facet?.querySelectorAll<HTMLElement>('[data-segment]') ?? []) seg.toggleAttribute('data-lit', seg.dataset.segment === value);
  };
  root.addEventListener('pointerover', (event) => light(event.target));
  root.addEventListener('focusin', (event) => light(event.target));
  root.addEventListener('pointerleave', clear);
  root.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Element) || !root.contains(event.relatedTarget)) clear();
  });
}

export function wireDisplay(root: HTMLElement, render: Render | null): void {
  syncButtons(root);
  const choose = <N extends PrefName>(name: N, value: PrefValue<N>, rearranges: boolean) => {
    savePref(storage(), name, value);
    const change = () => applyPref(root, name, value);
    if (render && rearranges) render({ change, animate: true });
    else change();
  };

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-view], button[data-by], button[data-group]') : null;
    if (!button) return;
    if (button.hasAttribute(BUTTONS.view)) {
      const view = parsePref('view', button.dataset.view);
      if (view !== currentPref(root, 'view')) choose('view', view, true);
    } else if (button.hasAttribute(BUTTONS.by)) {
      const by = parsePref('by', button.dataset.by);
      // The dye fades by itself (library.css); grouped, the groups change too.
      if (by !== currentPref(root, 'by')) choose('by', by, currentPref(root, 'group') === 'on');
    } else {
      choose('group', currentPref(root, 'group') === 'on' ? 'off' : 'on', true);
    }
  });
  wireSpotlight(root);
}
