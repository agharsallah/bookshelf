/**
 * Feedback while the ClientRouter fetches the next page. Every page renders on the
 * server, and the router waits for all of it before swapping, so without this a click
 * shows nothing until the new page lands.
 *
 * - After `BAR_DELAY_MS`, a thin bar along the top starts creeping across
 *   (`[data-nav-progress]`, persisted across swaps so it can finish its run).
 * - After `SKELETON_DELAY_MS`, the page's content gives way to a skeleton shaped like the
 *   page being opened: `<html data-navigating="reader|document|grid|page">`
 *   (components/shell/NavigationLoading.astro draws them).
 *
 * A page that arrives sooner shows neither, so fast navigations never flash. The swap
 * replaces `<html>`'s attributes with the new page's, which clears the skeleton.
 */

export type SkeletonKind = 'reader' | 'document' | 'grid' | 'page';

export const BAR_DELAY_MS = 120;
export const SKELETON_DELAY_MS = 350;
/** How long the bar takes to finish its run and fade once the page has arrived. */
export const BAR_FINISH_MS = 450;

const BEFORE_PREPARATION = 'astro:before-preparation';
const AFTER_PREPARATION = 'astro:after-preparation';
const AFTER_SWAP = 'astro:after-swap';

/** Pages that open on a grid of cards. */
const GRID_PAGES = new Set(['/library', '/papers', '/papers/sets', '/collections', '/concepts', '/you']);

/** The skeleton that best matches the page at `pathname`. */
export function skeletonFor(pathname: string): SkeletonKind {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (/^\/documents\/[^/]+\/read(\/|$)/.test(path)) return 'reader';
  if (/^\/documents\/[^/]+/.test(path)) return 'document';
  if (GRID_PAGES.has(path)) return 'grid';
  return 'page';
}

/** The parts of `astro:before-preparation` this needs. */
interface PreparationEvent extends Event {
  to?: URL;
}

/** Listens to the router's lifecycle on `doc` and drives the bar and the skeleton. */
export function trackNavigation(doc: Document = document): void {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const bar = () => doc.querySelector<HTMLElement>('[data-nav-progress]');
  const main = () => doc.getElementById('main');

  const showSkeleton = (kind: SkeletonKind) => {
    doc.documentElement.dataset.navigating = kind;
    main()?.setAttribute('aria-busy', 'true');
    doc.defaultView?.scrollTo({ top: 0, behavior: 'instant' });
  };
  const hideSkeleton = () => {
    delete doc.documentElement.dataset.navigating;
    main()?.removeAttribute('aria-busy');
  };

  doc.addEventListener(BEFORE_PREPARATION, (event: PreparationEvent) => {
    clear();
    hideSkeleton();
    const kind = skeletonFor(event.to?.pathname ?? '/');
    timers.push(
      setTimeout(() => {
        const el = bar();
        if (el) el.dataset.state = 'loading';
      }, BAR_DELAY_MS),
      setTimeout(() => showSkeleton(kind), SKELETON_DELAY_MS),
    );
  });

  // The page is here: nothing more appears, and a running bar finishes its run. The
  // skeleton stays until the swap so the old page does not flash back first.
  doc.addEventListener(AFTER_PREPARATION, () => {
    clear();
    const el = bar();
    if (el?.dataset.state !== 'loading') return;
    el.dataset.state = 'done';
    timers.push(
      setTimeout(() => {
        if (el.dataset.state === 'done') delete el.dataset.state;
      }, BAR_FINISH_MS),
    );
  });

  doc.addEventListener(AFTER_SWAP, hideSkeleton);
}
