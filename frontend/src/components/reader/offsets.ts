/**
 * DOM selection → character offsets in a block's text. A source block renders its
 * text as runs, `<span data-o="12">…</span>`, each holding one text node that starts
 * at offset 12 of the node's `text`. Anything outside a run (list markers, the
 * anchor handle) does not count, and a boundary there snaps to the next run.
 */
import type { NoteRange } from '../../lib/api/types/notes';

export const RUN_ATTR = 'data-o';

function runs(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${RUN_ATTR}]`)];
}

function runStart(run: Element): number {
  return Number(run.getAttribute(RUN_ATTR));
}

function runLength(run: Element): number {
  return run.textContent?.length ?? 0;
}

/** The offset a DOM boundary point `(node, offset)` stands for, or null if no runs exist. */
export function pointOffset(root: Element, node: Node, offset: number): number | null {
  const all = runs(root);
  if (all.length === 0) return null;

  if (node.nodeType === Node.TEXT_NODE) {
    const run = node.parentElement?.closest(`[${RUN_ATTR}]`);
    if (run && root.contains(run)) {
      // Text before this node inside the same run (runs normally hold one text node).
      let before = 0;
      for (const child of run.childNodes) {
        if (child === node) break;
        before += child.textContent?.length ?? 0;
      }
      return runStart(run) + before + Math.min(offset, node.textContent?.length ?? 0);
    }
  }

  // An element boundary or text outside any run: snap to the first run at or after it.
  const point = node.ownerDocument!.createRange();
  point.setStart(node, offset);
  for (const run of all) {
    if (point.comparePoint(run, 0) >= 0) return runStart(run);
  }
  const last = all.at(-1)!;
  return runStart(last) + runLength(last);
}

/** The selection as a range over the block's text; null when it is empty or leaves the block. */
export function selectionRange(root: Element, selection: Selection | null): NoteRange | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const a = pointOffset(root, range.startContainer, range.startOffset);
  const b = pointOffset(root, range.endContainer, range.endOffset);
  if (a === null || b === null) return null;
  const [start, end] = a <= b ? [a, b] : [b, a];
  return end > start ? { start, end } : null;
}

/** The block element (carrying `data-anchor`) a DOM node sits in, if any. */
export function blockOf(node: Node | null, attr = 'data-source-anchor'): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>(`[${attr}]`) ?? null;
}
