/**
 * Everything the reader needs for the "what matters" mode, in one hook: the marks for
 * the chapter (always computed, shown by CSS only when the mode is on, so toggling it
 * never re-renders the text), the meter, the card a marked passage opens, and the jump
 * to the next key idea.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { TreeNode } from '../../lib/api/types/documents';
import { revealBlock } from './dom';
import type { LexTerm } from './lexicon';
import type { Panes } from './panes';
import { buildSalience, citeWeights, groupSalience, type Salient, type SalienceByAnchor } from './salience';
import { SalienceCard } from './SalienceCard';
import { SalienceMeter } from './SalienceMeter';
import { useSalience } from './useSalience';

export interface SalienceModeOptions {
  sourceRef: RefObject<HTMLElement | null>;
  nodes: readonly TreeNode[];
  panes: Panes;
  lexicon: readonly LexTerm[];
  enabled: boolean;
  /** Where seen ideas are remembered: one key per chapter. */
  storageKey: string;
  order: ReadonlyMap<string, number>;
  activeAnchor: string | null;
  /** Save the passage as the reader's own highlight; resolves true once saved. */
  onKeep: (salient: Salient) => Promise<boolean>;
}

export interface SalienceMode {
  byAnchor: SalienceByAnchor;
  /** A click in the text: opens the card when it landed on a mark. Returns true if it did. */
  openAt: (target: Element, x: number, y: number) => boolean;
  next: () => void;
  meter: ReactNode;
  card: ReactNode;
}

const PICKED_ATTR = 'data-picked';

export function useSalienceMode(options: SalienceModeOptions): SalienceMode {
  const { sourceRef, nodes, panes, lexicon, enabled, storageKey, order, activeAnchor, onKeep } = options;
  const salients = useMemo(() => buildSalience(nodes, lexicon, citeWeights(panes)), [nodes, lexicon, panes]);
  const byAnchor = useMemo(() => groupSalience(salients), [salients]);
  const byId = useMemo(() => new Map(salients.map((s) => [s.id, s])), [salients]);
  const { ideas, seen, nextIdea } = useSalience(sourceRef, salients, enabled, storageKey);
  const [open, setOpen] = useState<{ id: string; x: number; y: number } | null>(null);
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const current = open ? (byId.get(open.id) ?? null) : null;

  // The passage whose card is open stays lit up, so it is clear what the card is about.
  useEffect(() => {
    const root = sourceRef.current;
    if (!current || !root) return;
    const id = CSS.escape(current.id);
    const els = root.querySelectorAll(`[data-sal-id="${id}"], [data-term="${id}"]`);
    els.forEach((el) => el.setAttribute(PICKED_ATTR, current.tier));
    return () => els.forEach((el) => el.removeAttribute(PICKED_ATTR));
  }, [current, sourceRef]);

  useEffect(() => {
    if (!enabled) setOpen(null);
  }, [enabled]);

  const openAt = useCallback(
    (target: Element, x: number, y: number) => {
      if (!enabled) return false;
      const run = target.closest<HTMLElement>('[data-term], [data-sal-id]');
      // A term is the more specific mark when it sits inside a marked sentence.
      const id = run?.dataset.term ?? run?.dataset.salId;
      if (!id || !byId.has(id)) return false;
      setOpen({ id, x, y });
      return true;
    },
    [enabled, byId],
  );

  const next = useCallback(() => {
    const target = nextIdea(current?.anchor ?? activeAnchor, order);
    setOpen(null);
    if (target && sourceRef.current) revealBlock(sourceRef.current, target.anchor);
  }, [nextIdea, current, activeAnchor, order, sourceRef]);

  const close = useCallback(() => setOpen(null), []);

  const keep = async (salient: Salient) => {
    setSaving(true);
    const ok = await onKeep(salient);
    setSaving(false);
    if (ok) setKept((before) => new Set([...before, salient.id]));
  };

  const found = ideas.filter((s) => seen.has(s.id)).length;
  return {
    byAnchor,
    openAt,
    next,
    meter: enabled ? <SalienceMeter seen={found} total={ideas.length} onNext={next} /> : null,
    card:
      enabled && current && open ? (
        <SalienceCard
          key={current.id}
          salient={current}
          x={open.x}
          y={open.y}
          kept={kept.has(current.id)}
          saving={saving}
          onKeep={() => void keep(current)}
          onNext={next}
          onClose={close}
        />
      ) : null,
  };
}
