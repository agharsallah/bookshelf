/**
 * The library's script. Without it the page still works: the GET form, tag and bucket
 * links, spine links and the dialog stand on their own. With it the library comes
 * alive: filters apply as you type (`live-filters.ts`), the display choices switch and
 * animate (`live-display.ts`, `live-motion.ts`), the spine you point at goes onto the lectern
 * (`live-lectern.ts`), and "Add a book" opens where invoker commands are missing.
 */
import { INGESTED_EVENT } from './ingest';
import { wireDisplay } from './live-display';
import { wireFilters } from './live-filters';
import { ADD_BOOK_DIALOG } from './live-ids';
import { wireLectern } from './live-lectern';
import { settle } from './live-motion';

export { formState, TYPING_DELAY } from './live-filters';

/** Long enough for the arrival animation to finish (Spine.module.css). */
const ARRIVAL = 2400;

function wireDialog(root: HTMLElement, signal?: AbortSignal): void {
  const dialog = document.getElementById(ADD_BOOK_DIALOG);
  if (!(dialog instanceof HTMLDialogElement)) return;
  // Invoker commands open the dialog natively; elsewhere, open it from here.
  if (!('command' in HTMLButtonElement.prototype)) {
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-add-book]')) {
      button.addEventListener('click', () => dialog.showModal());
    }
  }
  // `/library?add=…` arrives with the desk open.
  if (dialog.dataset.openOnLoad !== undefined && !dialog.open) dialog.showModal();
  let added = false;
  window.addEventListener(INGESTED_EVENT, () => (added = true), { signal });
  dialog.addEventListener('close', () => {
    if (added) location.reload();
  });
}

/** Wire the library page; `signal` ends its window listeners when the page is left. */
export function initLibrary(root: HTMLElement, signal?: AbortSignal): void {
  root.dataset.live = '';
  const render = wireFilters(root);
  wireDisplay(root, render);
  wireLectern(root);
  wireDialog(root, signal);
  const timer = setTimeout(() => settle(root), ARRIVAL);
  signal?.addEventListener('abort', () => clearTimeout(timer));
}
