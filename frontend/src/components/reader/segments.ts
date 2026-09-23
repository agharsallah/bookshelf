/**
 * Highlight geometry over a block's plain text. Note ranges are character offsets
 * into the node's `text` (backend NoteRange), so the reader renders text as runs that
 * each remember where they start, and highlights split those runs.
 */
import type { HighlightColor } from '../../lib/contract';

export interface Mark {
  id: string;
  start: number;
  end: number;
  color: HighlightColor;
}

/** A stretch of text under the same set of marks. `marks` keeps input order (oldest first). */
export interface Segment {
  start: number;
  end: number;
  marks: Mark[];
}

/**
 * Cut `[0, length)` into segments at every mark boundary. Overlapping marks produce
 * segments carrying several marks; marks outside the text are clipped, empty ones dropped.
 */
export function segment(length: number, marks: readonly Mark[]): Segment[] {
  const valid = marks
    .map((m) => ({ ...m, start: Math.max(0, m.start), end: Math.min(length, m.end) }))
    .filter((m) => m.end > m.start);
  const cuts = new Set<number>([0, length]);
  for (const m of valid) {
    cuts.add(m.start);
    cuts.add(m.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  points.slice(1).forEach((end, i) => {
    const start = points[i] ?? end;
    if (end <= start) return;
    const covering = valid.filter((m) => m.start <= start && m.end >= end);
    const previous = out.at(-1);
    if (previous && previous.marks.length === 0 && covering.length === 0) {
      previous.end = end;
    } else {
      out.push({ start, end, marks: covering });
    }
  });
  return out;
}

/** The colour a segment shows: the newest mark wins where highlights overlap. */
export function topColor(seg: Segment): HighlightColor | null {
  return seg.marks.at(-1)?.color ?? null;
}

/** A visual piece of a block (a line of an aside, an item of a list) as a text range. */
export interface Piece {
  start: number;
  end: number;
}

const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s+/;

/**
 * Split text into lines (paragraph breaks inside asides, list items). For lists the
 * leading marker (`- `, `1. `) is excluded from the piece, so highlights never cover it.
 */
export function pieces(text: string, { stripMarkers = false } = {}): Piece[] {
  const out: Piece[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const marker = stripMarkers ? (LIST_MARKER.exec(line)?.[0].length ?? 0) : 0;
    if (line.length > marker) out.push({ start: offset + marker, end: offset + line.length });
    offset += line.length + 1;
  }
  return out;
}

/** The segments that fall inside a piece, clipped to it. */
export function clip(segments: readonly Segment[], piece: Piece): Segment[] {
  return segments
    .filter((s) => s.end > piece.start && s.start < piece.end)
    .map((s) => ({ ...s, start: Math.max(s.start, piece.start), end: Math.min(s.end, piece.end) }));
}
