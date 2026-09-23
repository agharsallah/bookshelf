/**
 * How a document stands on the shelf. A spine's thickness follows its page count,
 * its height and cloth are picked from its slug, so a book looks the same every
 * visit and neighbours rarely match.
 */
import type { DocumentSummary } from '../../lib/api/types/documents';

export const CLOTHS = ['oxblood', 'navy', 'forest', 'ochre', 'slate', 'plum', 'teal'] as const;
export type Cloth = (typeof CLOTHS)[number];

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
  if (doc.kind === 'article') return { cloth, width: 2.25, height: 11 + ((h >> 4) % 3) * 0.5 };
  const pages = doc.page_count ?? 200;
  const width = Math.round((2.5 + Math.min(pages, 900) / 900 * 1.9) * 100) / 100;
  return { cloth, width, height: 13.5 + ((h >> 4) % 5) * 0.5 };
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
