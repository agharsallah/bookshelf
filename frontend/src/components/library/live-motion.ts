/**
 * Moving books on the shelf. Each book has its own view-transition name
 * (`book-style.ts`), so a change made inside `moveShelf` lets them glide to their new
 * places, leave downwards and arrive from above (`library.css`) instead of jumping.
 * Without view transitions, under reduced motion, or with a shelf too big to animate
 * smoothly, the change simply happens.
 */

/** Past this many books on show, re-arranging is instant. */
export const MAX_MOVING = 150;

type Transitioning = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

let moving = 0;

/** Stop the arrival animation for good: re-inserted elements would replay it. */
export function settle(root: HTMLElement): void {
  root.dataset.settled = '';
}

export function moveShelf(root: HTMLElement, update: () => void): void {
  settle(root);
  const doc = document as Transitioning;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
  const books = root.querySelectorAll('[data-book]:not([hidden])').length;
  if (!doc.startViewTransition || reduce || books > MAX_MOVING || doc.visibilityState === 'hidden') {
    update();
    return;
  }
  const html = doc.documentElement;
  moving += 1;
  html.dataset.shelfMoving = '';
  const done = () => {
    moving -= 1;
    if (moving === 0) delete html.dataset.shelfMoving;
  };
  const transition = doc.startViewTransition(update);
  // A skipped transition (say, a snapshot that could not be taken) still runs the update.
  transition.ready.catch(() => undefined);
  transition.finished.then(done, done);
}
