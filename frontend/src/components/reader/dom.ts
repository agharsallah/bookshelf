/**
 * DOM effects the reader applies directly, outside React state, so a hover or a
 * cite never re-renders hundreds of source blocks.
 */

export const SOURCE_ATTR = 'data-source-anchor';

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function sourceBlock(root: ParentNode, anchor: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${SOURCE_ATTR}="${CSS.escape(anchor)}"]`);
}

/** Scroll a block into view, focus it and flash it. Returns false when it is not on this page. */
export function revealBlock(root: ParentNode, anchor: string): boolean {
  const el = sourceBlock(root, anchor);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
  el.classList.remove('is-flashing');
  // Restart the animation even when the same block is flashed twice in a row.
  void el.offsetWidth;
  el.classList.add('is-flashing');
  el.addEventListener('animationend', () => el.classList.remove('is-flashing'), { once: true });
  setTimeout(() => el.classList.remove('is-flashing'), 2000);
  return true;
}

/** The text container a cite chip annotates (its span's paragraph, item or cell). */
function citedContent(chip: Element): Element {
  return chip.closest('li, td, th, p, blockquote, figure, dd, [data-block]') ?? chip;
}

/** Mark every element in `pane` citing `anchor` (or any anchor under it); returns an undo. */
export function markCiting(pane: ParentNode, anchor: string): () => void {
  const marked: Element[] = [];
  pane.querySelectorAll<HTMLElement>('[data-anchor]').forEach((chip) => {
    const cited = chip.dataset.anchor ?? '';
    if (cited === anchor || cited.startsWith(`${anchor}/`)) {
      marked.push(chip, citedContent(chip));
    }
  });
  marked.forEach((el) => el.classList.add('is-cited'));
  return () => marked.forEach((el) => el.classList.remove('is-cited'));
}

/** Scroll `pane` (its own scroll box) so `target` sits near its top. */
export function scrollPaneTo(pane: HTMLElement, target: Element): void {
  const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 16;
  pane.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** True when a key press is typing, not a reader shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
