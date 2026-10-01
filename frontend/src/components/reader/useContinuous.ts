/**
 * `useContinuous` — continuous reading: the chapters after this one are fetched and
 * added below it as the end of the page comes near, so the book reads in one scroll.
 * Each is loaded once, in order; it stops after a truncated chapter (its missing tail
 * would be skipped silently) and on a failed load, where the plain "Next" link takes over.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { browserApi } from '../../lib/api/client';
import type { NodeSubtree, TreeNode } from '../../lib/api/types/documents';
import { flatten, isUnder, type FlatNode } from '../../lib/documents/tree';
import type { NavUnit } from './Navigator';

export interface ContinuedChapter {
  unit: TreeNode;
  flat: FlatNode[];
  truncated: boolean;
}

export interface Continuous {
  /** The chapters added below the opened one, in reading order. */
  chapters: ContinuedChapter[];
  /** The next chapter still to add, or null: none left, or adding stopped. */
  pending: NavUnit | null;
}

const NONE: ContinuedChapter[] = [];

/** How far below the viewport the next chapter starts loading. */
const LOAD_AHEAD = '0px 0px 150% 0px';

export function useContinuous({
  enabled,
  slug,
  following,
  stopped,
  sentinel,
}: {
  enabled: boolean;
  slug: string;
  /** The chapters after the opened one. */
  following: readonly NavUnit[];
  /** The opened chapter cannot be continued from (it is truncated). */
  stopped: boolean;
  /** Placed after the last chapter shown: in view, the next one loads. */
  sentinel: RefObject<HTMLElement | null>;
}): Continuous {
  const [chapters, setChapters] = useState<ContinuedChapter[]>(NONE);
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);

  const last = chapters.at(-1);
  const halted = stopped || failed || Boolean(last?.truncated);
  const pending = enabled && !halted ? (following[chapters.length] ?? null) : null;

  // A new observer after each chapter: it reports at once if the sentinel is still in reach.
  useEffect(() => {
    const el = sentinel.current;
    if (!pending || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || loading.current) return;
        loading.current = true;
        browserApi
          .get<NodeSubtree>(`nodes/${slug}/${pending.anchor}`)
          .then(({ node, truncated }) => setChapters((cs) => [...cs, { unit: node, flat: flatten(node), truncated }]))
          .catch(() => setFailed(true))
          .finally(() => {
            loading.current = false;
          });
      },
      { rootMargin: LOAD_AHEAD },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [pending, slug, sentinel]);

  return { chapters: enabled ? chapters : NONE, pending };
}

/** The added chapter that holds `anchor`, or null (it is in the opened chapter). */
export function chapterOf(chapters: readonly ContinuedChapter[], anchor: string | null): ContinuedChapter | null {
  return anchor ? (chapters.find((c) => isUnder(anchor, c.unit.anchor)) ?? null) : null;
}
