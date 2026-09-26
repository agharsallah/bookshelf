/**
 * How a document stands on the shelf. A spine's thickness follows its page count,
 * its height and cloth are picked from its slug, so a book looks the same every
 * visit and neighbours rarely match. The title is set to fit: the largest type that
 * lets the short title (before any subtitle) run in one or more vertical lines,
 * growing the spine up to the shelf's height before it shrinks the type.
 */
import type { DocumentSummary } from '../../lib/api/types/documents';

export const CLOTHS = ['oxblood', 'navy', 'forest', 'ochre', 'slate', 'plum', 'teal'] as const;
export type Cloth = (typeof CLOTHS)[number];

/** Cloth dyes: dark enough for paper-coloured type in both themes (>= 7:1). */
export const CLOTH_COLORS: Record<Cloth, string> = {
  oxblood: '#6d2a2a',
  navy: '#25355a',
  forest: '#2c4a37',
  ochre: '#6e4f16',
  slate: '#3b4450',
  plum: '#4e2c4d',
  teal: '#1d4f52',
};

/** A small, stable string hash (FNV-1a). */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface SpineLook {
  cloth: Cloth;
  /** Thickness in rem. */
  width: number;
  /** Height in rem. */
  height: number;
}

export function spineLook(doc: Pick<DocumentSummary, 'slug' | 'kind' | 'page_count'>): SpineLook {
  const h = hash(doc.slug);
  const cloth: Cloth = CLOTHS[h % CLOTHS.length] ?? 'navy';
  if (doc.kind === 'article') return { cloth, width: 2.4, height: 13 + ((h >> 4) % 3) * 0.5 };
  const pages = doc.page_count ?? 200;
  const width = Math.round((2.6 + (Math.min(pages, 900) / 900) * 2.2) * 100) / 100;
  return { cloth, width, height: 15.5 + ((h >> 4) % 5) * 0.6 };
}

/** The tallest a spine may grow to fit its title (the shelf row is a little taller). */
export const MAX_SPINE_HEIGHT = 19;

/** "Thinking in Systems: A Primer" → "Thinking in Systems"; the subtitle is on the card. */
export function shortTitle(title: string): string {
  const main = title.split(/\s*[:—–]\s+|\s+-\s+/)[0]?.trim();
  return main || title.trim();
}

export interface TitleFit {
  text: string;
  /** Type size in rem. */
  size: number;
  /** Vertical lines the title runs in. */
  lines: number;
  /** The spine's height in rem, grown when the title needed it. */
  height: number;
  /** True when even the smallest type could not fit it all (the line ends in an ellipsis). */
  clipped: boolean;
}

/** Average advance of the spine's serif and the author's italic, in em (measured). */
const ADVANCE = 0.54;
const AUTHOR_ADVANCE = 0.62;
const LEADING = 1.15;
const SIZES = [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.76, 0.72];

/** Lines a greedy word wrap needs at `capacity` characters per line. */
function linesAt(words: readonly string[], capacity: number): number {
  let lines = 1;
  let used = -1;
  for (const word of words) {
    if (used + 1 + word.length <= capacity) used += 1 + word.length;
    else if (used < 0) used = word.length;
    else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

/** The shortest line length (in characters) that wraps the words into `lines` lines. */
export function wrapLength(words: readonly string[], lines: number): number {
  const total = words.join(' ').length;
  let capacity = Math.max(...words.map((w) => w.length));
  while (capacity < total && linesAt(words, capacity) > lines) capacity += 1;
  return capacity;
}

/**
 * Fit the title on the spine. Room along the spine is its height less the band, the
 * author and the label; room across is its width less the margins.
 */
export function titleFit(title: string, authors: readonly string[], look: Pick<SpineLook, 'width' | 'height'>): TitleFit {
  const text = shortTitle(title);
  const words = text.split(/\s+/);
  const author = Math.min(spineAuthor(authors).length * AUTHOR_ADVANCE * 0.72, 5);
  const reserved = 5.5 + author;
  const across = look.width - 0.9;

  const needFor = (size: number) => {
    const most = Math.max(1, Math.min(3, Math.floor(across / (size * LEADING)), words.length));
    let best = { lines: 1, height: Infinity };
    for (let lines = 1; lines <= most; lines += 1) {
      const height = reserved + wrapLength(words, lines) * ADVANCE * size + 0.3;
      if (height < best.height - 0.01) best = { lines, height };
    }
    return best;
  };
  const round = (n: number) => Math.round(n * 100) / 100;

  for (const limit of [look.height, MAX_SPINE_HEIGHT]) {
    for (const size of SIZES) {
      if (limit === look.height && size < 0.8) break;
      const need = needFor(size);
      if (need.height <= limit) {
        return { text, size, lines: need.lines, height: round(Math.max(look.height, need.height)), clipped: false };
      }
    }
  }
  const smallest = SIZES.at(-1) ?? 0.72;
  return { text, size: smallest, lines: needFor(smallest).lines, height: MAX_SPINE_HEIGHT, clipped: true };
}

/** "Donella Meadows" → "Meadows"; several authors → "Meadows et al." */
export function spineAuthor(authors: readonly string[]): string {
  const first = authors[0]?.trim();
  if (!first) return '';
  const surname = first.includes(',') ? (first.split(',')[0] ?? first).trim() : (first.split(/\s+/).at(-1) ?? first);
  return authors.length > 1 ? `${surname} et al.` : surname;
}

/** Drafts and flagged artifacts waiting for a human decision. */
export function waitingReview(doc: Pick<DocumentSummary, 'artifacts'>): number {
  return doc.artifacts.draft + doc.artifacts.needs_review;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
