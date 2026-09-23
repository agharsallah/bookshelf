/**
 * Notes → highlight marks per block. The reader re-renders a block only when its own
 * marks change, so unchanged groups keep the array they had before.
 */
import type { NoteDetail } from '../../lib/api/types/notes';
import type { Mark } from './segments';

export type MarksByAnchor = ReadonlyMap<string, readonly Mark[]>;

const EMPTY: readonly Mark[] = Object.freeze([]);

function same(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((m, i) => {
    const o = b[i];
    return o !== undefined && m.id === o.id && m.start === o.start && m.end === o.end && m.color === o.color;
  });
}

/** Ranged, attached notes as marks, oldest first, grouped by anchor. */
export function groupMarks(notes: readonly NoteDetail[], previous: MarksByAnchor = new Map()): MarksByAnchor {
  const next = new Map<string, Mark[]>();
  const ordered = [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const note of ordered) {
    if (note.detached || !note.range) continue;
    const list = next.get(note.anchor) ?? [];
    list.push({ id: note.id, start: note.range.start, end: note.range.end, color: note.color ?? 'amber' });
    next.set(note.anchor, list);
  }
  const out = new Map<string, readonly Mark[]>();
  for (const [anchor, marks] of next) {
    const before = previous.get(anchor);
    out.set(anchor, before && same(before, marks) ? before : marks);
  }
  return out;
}

export function marksFor(groups: MarksByAnchor, anchor: string): readonly Mark[] {
  return groups.get(anchor) ?? EMPTY;
}

/** Anchors carrying a block-level note (no range), for the margin marker. */
export function notedBlocks(notes: readonly NoteDetail[]): ReadonlySet<string> {
  return new Set(notes.filter((n) => !n.detached && !n.range).map((n) => n.anchor));
}
