/**
 * The reader's DOM-level interactions, kept out of the component body:
 * selection → highlight toolbar, cross-pane hover highlighting, copy-link handles,
 * clicks on existing highlights, and the keyboard shortcuts
 * (j/k block, [/] chapter, n note, Esc close; the rest via `onAction`).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { toast } from '../document/toast';
import type { ComposerTarget } from '../notes/NoteComposer';
import { blockOf, selectionRange } from './offsets';
import { isTyping, markCiting, SOURCE_ATTR, sourceBlock } from './dom';
import { TEXT_KINDS } from './SourceBlock';

export interface ReaderEventOptions {
  sourceRef: RefObject<HTMLElement | null>;
  paneRef: RefObject<HTMLElement | null>;
  /** Anchors in reading order, for j/k. */
  anchors: readonly string[];
  activeAnchor: string | null;
  linkFor: (anchor: string) => string;
  prevHref: string | null;
  nextHref: string | null;
  onSelect: (target: ComposerTarget | null) => void;
  onCompose: (target: ComposerTarget) => void;
  onEscape: () => void;
  onNoteClick: (noteId: string) => void;
  /** Any other key press; return true when it was a shortcut, to claim it. */
  onAction: (event: KeyboardEvent) => boolean;
}

function selectionTarget(root: HTMLElement): ComposerTarget | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const domRange = selection.getRangeAt(0);
  const block = blockOf(domRange.startContainer);
  if (!block || !root.contains(block) || block !== blockOf(domRange.endContainer)) return null;
  if (!TEXT_KINDS.has(block.dataset.kind ?? '')) return null;
  const range = selectionRange(block, selection);
  if (!range) return null;
  const rect = domRange.getBoundingClientRect();
  return {
    anchor: block.getAttribute(SOURCE_ATTR) ?? '',
    range,
    passage: selection.toString(),
    x: rect.left + rect.width / 2,
    y: rect.bottom,
  };
}

export function useReaderEvents(options: ReaderEventOptions): void {
  // The latest options, read by listeners attached once.
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const source = options.sourceRef.current;
    const pane = options.paneRef.current;
    if (!source) return;
    let undoCited: (() => void) | null = null;
    let hovered: string | null = null;
    let citing: HTMLElement | null = null;

    const onPointerUp = () => {
      // Let the browser finish updating the selection first.
      setTimeout(() => latest.current.onSelect(selectionTarget(source)), 0);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === 'Shift') onPointerUp();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const handle = target?.closest<HTMLElement>('[data-copy-anchor]');
      if (handle) {
        const url = new URL(latest.current.linkFor(handle.dataset.copyAnchor ?? ''), window.location.href).href;
        void navigator.clipboard?.writeText(url).then(
          () => toast('Link copied.', 'good'),
          () => toast(url, 'info'),
        );
        return;
      }
      const mark = target?.closest<HTMLElement>('mark[data-notes]');
      const selection = window.getSelection();
      if (mark && (!selection || selection.isCollapsed)) {
        const first = mark.dataset.notes?.split(' ')[0];
        if (first) latest.current.onNoteClick(first);
      }
    };
    const onSourceOver = (event: MouseEvent) => {
      const block = blockOf(event.target instanceof Node ? event.target : null);
      const anchor = block?.getAttribute(SOURCE_ATTR) ?? null;
      if (anchor === hovered) return;
      hovered = anchor;
      undoCited?.();
      undoCited = anchor && latest.current.paneRef.current ? markCiting(latest.current.paneRef.current, anchor) : null;
    };
    const onSourceLeave = () => {
      hovered = null;
      undoCited?.();
      undoCited = null;
    };
    const onPaneOver = (event: MouseEvent) => {
      const chip = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-anchor]') : null;
      const next = chip?.dataset.anchor ? sourceBlock(source, chip.dataset.anchor) : null;
      if (next === citing) return;
      citing?.classList.remove('is-citing');
      citing = next;
      citing?.classList.add('is-citing');
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const o = latest.current;
      if (event.key === 'Escape') {
        o.onEscape();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const focused = blockOf(document.activeElement);
      const current = focused?.getAttribute(SOURCE_ATTR) ?? o.activeAnchor;
      const index = current ? o.anchors.indexOf(current) : -1;
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const next = o.anchors[Math.min(o.anchors.length - 1, Math.max(0, index + (event.key === 'j' ? 1 : -1)))];
        const el = next ? sourceBlock(source, next) : null;
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === ']' && o.nextHref) {
        window.location.assign(o.nextHref);
      } else if (event.key === '[' && o.prevHref) {
        window.location.assign(o.prevHref);
      } else if (o.onAction(event)) {
        event.preventDefault();
      } else if (event.key === 'n' && current) {
        event.preventDefault();
        const selected = selectionTarget(source);
        const rect = (focused ?? sourceBlock(source, current))?.getBoundingClientRect();
        o.onCompose(selected ?? { anchor: current, range: null, passage: '', x: rect ? rect.left + rect.width / 2 : 200, y: rect ? rect.top + 24 : 200 });
      }
    };

    source.addEventListener('mouseup', onPointerUp);
    source.addEventListener('keyup', onKeyUp);
    source.addEventListener('click', onClick);
    source.addEventListener('mouseover', onSourceOver);
    source.addEventListener('mouseleave', onSourceLeave);
    pane?.addEventListener('mouseover', onPaneOver);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      source.removeEventListener('mouseup', onPointerUp);
      source.removeEventListener('keyup', onKeyUp);
      source.removeEventListener('click', onClick);
      source.removeEventListener('mouseover', onSourceOver);
      source.removeEventListener('mouseleave', onSourceLeave);
      pane?.removeEventListener('mouseover', onPaneOver);
      document.removeEventListener('keydown', onKeyDown);
      undoCited?.();
      citing?.classList.remove('is-citing');
    };
  }, [options.sourceRef, options.paneRef]);
}

