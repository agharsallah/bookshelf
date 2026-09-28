/**
 * The lectern shows the book you point at: resting the pointer on a spine (or focusing
 * it) puts that book on the lectern, face out, cloned from its `<template>`. A spine is
 * a plain link, so a click always opens the book's page. The pointer has to rest a
 * moment (`DWELL`), so sweeping across the shelf on the way to the lectern does not swap
 * the book under you. The arrow keys walk along the shelf, Home and End go to its ends.
 * Only on the wide shelf; on narrow screens and in the list the lectern stays as it is.
 */

/** As wide as the page must be for the lectern to stand beside the shelf (Lectern.module.css). */
export const LECTERN_MEDIA = '(min-width: 60.01rem)';
/** How long the pointer rests on a spine before the lectern shows it. */
export const DWELL = 180;

const WALK_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function wireLectern(root: HTMLElement): void {
  const slot = root.querySelector<HTMLElement>('[data-lectern-slot]');
  const status = root.querySelector<HTMLElement>('[data-lectern-status]');
  if (!slot) return;
  const wide = () => window.matchMedia?.(LECTERN_MEDIA).matches ?? true;
  const onShelf = () => root.classList.contains('view-shelf') && wide();
  const spineOf = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLAnchorElement>('.shelf-view a[data-spine]') : null;
  const slugOf = (spine: Element) => spine.closest<HTMLElement>('[data-book]')?.dataset.book;
  const spines = () =>
    [...root.querySelectorAll<HTMLAnchorElement>('.shelf-view a[data-spine]')].filter((a) => !a.closest<HTMLElement>('[data-book]')?.hidden);

  const show = (slug: string) => {
    if (slot.dataset.book === slug) return;
    const template = root.querySelector<HTMLTemplateElement>(`template[data-lectern-for="${CSS.escape(slug)}"]`);
    if (!template) return;
    slot.replaceChildren(template.content.cloneNode(true));
    slot.dataset.book = slug;
    for (const spine of root.querySelectorAll<HTMLAnchorElement>('a[data-spine]')) {
      if (slugOf(spine) === slug) spine.setAttribute('aria-current', 'true');
      else spine.removeAttribute('aria-current');
    }
    const title = root.querySelector<HTMLElement>(`[data-book="${CSS.escape(slug)}"]`)?.dataset.title;
    if (status && title) status.textContent = `${title}, on the lectern`;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  root.addEventListener('pointerover', (event) => {
    const spine = spineOf(event.target);
    clearTimeout(timer);
    const slug = spine ? slugOf(spine) : undefined;
    if (!slug || !onShelf() || (event instanceof PointerEvent && event.pointerType === 'touch')) return;
    timer = setTimeout(() => show(slug), DWELL);
  });
  root.addEventListener('pointerout', (event) => {
    if (spineOf(event.target)) clearTimeout(timer);
  });
  root.addEventListener('focusin', (event) => {
    const spine = spineOf(event.target);
    const slug = spine ? slugOf(spine) : undefined;
    if (slug && onShelf()) show(slug);
  });

  root.addEventListener('keydown', (event) => {
    const spine = spineOf(event.target);
    if (!spine || !WALK_KEYS.has(event.key) || event.altKey || event.metaKey || event.ctrlKey) return;
    const all = spines();
    const at = all.indexOf(spine);
    if (at < 0) return;
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = event.key === 'Home' ? all[0] : event.key === 'End' ? all.at(-1) : all[at + step];
    event.preventDefault();
    next?.focus(); // focusing it puts it on the lectern
  });
}
