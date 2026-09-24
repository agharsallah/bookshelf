/**
 * Highlights and notes on the reading pane (the chapter distillation or summary).
 *
 * A pane note marks a passage of one top-level render block of one artifact: `block`
 * is the block's index, `range` code-point offsets into the block's text. A block's
 * text is every text node inside it in document order, except cite chips, drawn
 * diagrams and visual-only copies (`aria-hidden`), which are not prose and may render
 * late. Highlights are painted with the CSS Custom Highlight API, so the blocks
 * render exactly as they do everywhere else.
 */
import type { NoteDetail } from '../../lib/api/types/notes';
import type { HighlightColor } from '../../lib/contract';
import { toCodePointOffset, toCodePointRange, toUtf16Range } from '../../lib/codepoints';
import type { ComposerTarget } from '../notes/NoteComposer';
import { scrollPaneTo } from './dom';

/** On an entry that takes notes: the artifact id. `data-notable-target` names its kind. */
export const NOTABLE_ATTR = 'data-notable';
export const NOTABLE_TARGET_ATTR = 'data-notable-target';
/** The longest passage a pane note can quote (backend `notes.quote`). */
export const MAX_QUOTE = 2000;

const SKIP = '[data-cites], svg, [aria-hidden="true"]';

interface Spot {
  section: HTMLElement;
  block: HTMLElement;
  index: number;
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function topBlocks(section: Element): HTMLElement[] {
  const root = section.querySelector('[data-blocks]');
  return root ? [...root.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-block')) : [];
}

/** The notable entry and top-level block a DOM node sits in, if any. */
function spotOf(node: Node | null): Spot | null {
  const el = node ? elementOf(node) : null;
  const section = el?.closest<HTMLElement>(`[${NOTABLE_ATTR}]`);
  if (!el || !section) return null;
  const blocks = topBlocks(section);
  const index = blocks.findIndex((b) => b.contains(el));
  const block = blocks[index];
  return block ? { section, block, index } : null;
}

function textNodes(block: Element): Text[] {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const skipped = node.parentElement?.closest(SKIP);
      return skipped && block.contains(skipped) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** The text a block's offsets count through. */
export function blockText(block: Element): string {
  return textNodes(block)
    .map((t) => t.data)
    .join('');
}

/** A DOM boundary point as a UTF-16 offset into the block's text; outside the text snaps forward. */
function boundaryOffset(block: Element, nodes: readonly Text[], node: Node, offset: number): number {
  let before = 0;
  for (const t of nodes) {
    if (t === node) return before + Math.min(offset, t.data.length);
    before += t.data.length;
  }
  const point = block.ownerDocument.createRange();
  point.setStart(node, offset);
  let at = 0;
  for (const t of nodes) {
    if (point.comparePoint(t, 0) >= 0) return at;
    at += t.data.length;
  }
  return at;
}

/** A DOM range over UTF-16 offsets `[start, end)` of the block's text. */
function domRange(block: Element, start: number, end: number): Range | null {
  const nodes = textNodes(block);
  const range = block.ownerDocument.createRange();
  let at = 0;
  let started = false;
  for (const t of nodes) {
    const next = at + t.data.length;
    if (!started && start < next) {
      range.setStart(t, start - at);
      started = true;
    }
    if (started && end <= next) {
      range.setEnd(t, end - at);
      return range;
    }
    at = next;
  }
  return null;
}

/** The current selection as a pane note target; null unless it lies within one notable block. */
export function paneSelectionTarget(pane: HTMLElement, selection: Selection | null = window.getSelection()): ComposerTarget | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const spot = spotOf(range.startContainer);
  if (!spot || !pane.contains(spot.section) || spotOf(range.endContainer)?.block !== spot.block) return null;
  const nodes = textNodes(spot.block);
  const a = boundaryOffset(spot.block, nodes, range.startContainer, range.startOffset);
  const b = boundaryOffset(spot.block, nodes, range.endContainer, range.endOffset);
  const [start, end] = a <= b ? [a, b] : [b, a];
  const text = nodes.map((t) => t.data).join('');
  const quote = text.slice(start, end);
  if (!quote.trim() || quote.length > MAX_QUOTE) return null;
  const rect = range.getBoundingClientRect();
  return {
    anchor: spot.section.dataset.scope ?? '',
    range: { start, end },
    passage: quote,
    x: rect.left + rect.width / 2,
    y: rect.bottom,
    pane: {
      artifactId: spot.section.getAttribute(NOTABLE_ATTR) ?? '',
      block: spot.index,
      quote,
      range: toCodePointRange(text, { start, end }),
    },
  };
}

function blockFor(pane: ParentNode, note: NoteDetail): HTMLElement | null {
  if (!note.artifact_id || note.block === null) return null;
  const section = pane.querySelector(`[${NOTABLE_ATTR}="${CSS.escape(note.artifact_id)}"]`);
  return section ? (topBlocks(section)[note.block] ?? null) : null;
}

/** The DOM range a pane note marks, when its artifact is shown and its words are still there. */
export function paneNoteRange(pane: ParentNode, note: NoteDetail): Range | null {
  const block = blockFor(pane, note);
  if (!block || !note.range) return null;
  const text = blockText(block);
  const { start, end } = toUtf16Range(text, note.range);
  if (text.slice(start, end) !== note.quote) return null;
  return domRange(block, start, end);
}

const noUndo = (): void => undefined;

/** Paint the pane notes that are on screen, one highlight per colour; returns an undo. */
export function paintPaneNotes(pane: ParentNode, notes: readonly NoteDetail[]): () => void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return noUndo;
  const byColor = new Map<HighlightColor, Range[]>();
  for (const note of notes) {
    const range = paneNoteRange(pane, note);
    if (!range) continue;
    const color = note.color ?? 'amber';
    byColor.set(color, [...(byColor.get(color) ?? []), range]);
  }
  const names = [...byColor.keys()].map((c) => `note-${c}`);
  for (const [color, ranges] of byColor) CSS.highlights.set(`note-${color}`, new Highlight(...ranges));
  return () => names.forEach((name) => CSS.highlights.delete(name));
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const position = typeof doc.caretPositionFromPoint === 'function' ? doc.caretPositionFromPoint(x, y) : null;
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The id of the pane note under a point (the newest, when highlights overlap). */
export function paneNoteAt(notes: readonly NoteDetail[], x: number, y: number): string | null {
  const caret = caretAt(x, y);
  const spot = caret ? spotOf(caret.node) : null;
  if (!caret || !spot) return null;
  const nodes = textNodes(spot.block);
  const text = nodes.map((t) => t.data).join('');
  const at = toCodePointOffset(text, boundaryOffset(spot.block, nodes, caret.node, caret.offset));
  const artifactId = spot.section.getAttribute(NOTABLE_ATTR);
  const hit = notes.filter(
    (n) => n.artifact_id === artifactId && n.block === spot.index && n.range && n.range.start <= at && at < n.range.end,
  );
  return hit.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id ?? null;
}

/** Scroll the pane to the block a note marks and flash it; false when it is not shown. */
export function revealPaneNote(pane: HTMLElement, note: NoteDetail): boolean {
  const block = blockFor(pane, note);
  if (!block) return false;
  scrollPaneTo(pane, block);
  block.classList.remove('is-flashing');
  void block.offsetWidth;
  block.classList.add('is-flashing');
  setTimeout(() => block.classList.remove('is-flashing'), 2000);
  return true;
}
