/**
 * Page scripts under the `ClientRouter` (BaseLayout): moving to another page swaps the
 * document without reloading it, so a bundled `<script>` runs once, not once per page.
 * `onPage(setup)` runs `setup` on every page shown — the first load and each navigation
 * after — with a signal that aborts when that page is swapped out, for the listeners it
 * adds to `window` or `document` (`{ signal }`), so they go with it.
 */

export const PAGE_LOAD = 'astro:page-load';
export const BEFORE_SWAP = 'astro:before-swap';

export function onPage(setup: (signal: AbortSignal) => void, doc: Document = document): void {
  let controller: AbortController | null = null;
  const leave = () => {
    controller?.abort();
    controller = null;
  };
  doc.addEventListener(PAGE_LOAD, () => {
    leave();
    controller = new AbortController();
    setup(controller.signal);
  });
  doc.addEventListener(BEFORE_SWAP, leave);
}
