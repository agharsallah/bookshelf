/**
 * What the pill views need from a pill, as pure functions: where a cite points, which
 * colour its source chip wears, the labels of kinds and modes, and what a key press
 * means. Kept apart from the views so each is tested without rendering.
 */
import { DYES, FIXED_BUCKETS, type Dye } from '../library/facets';
import { hash } from '../library/spine';
import { readerHref } from '../search/links';
import type { FeedMode, Pill, PillDocument, PillKind } from '../../lib/pills/types';

// ---- Cites ------------------------------------------------------------------------------

export interface CiteTarget {
  slug: string;
  anchor: string;
}

/**
 * Where a cite points. A pill's `sources` resolve it when they can; otherwise a
 * `<slug>:<anchor>` names its document, and a bare anchor is in `fallbackSlug` (the pill's
 * own document, or a connection side's).
 */
export function resolveCite(pill: Pick<Pill, 'sources'>, cite: string, fallbackSlug: string): CiteTarget {
  const source = pill.sources[cite];
  if (source) return { slug: source.document.slug, anchor: source.anchor };
  const at = cite.indexOf(':');
  if (at > 0) return { slug: cite.slice(0, at), anchor: cite.slice(at + 1) };
  return { slug: fallbackSlug, anchor: cite };
}

/** The passage `o` and "Read" open: the pill's first cite, else its unit. */
export function primarySource(pill: Pick<Pill, 'sources' | 'cites' | 'document' | 'anchor'>): CiteTarget {
  const first = pill.cites[0];
  return first ? resolveCite(pill, first, pill.document.slug) : { slug: pill.document.slug, anchor: pill.anchor };
}

export function citeReaderHref(target: CiteTarget): string {
  return readerHref(target.slug, target.anchor);
}

// ---- Colour -----------------------------------------------------------------------------

const THEME_DYES: readonly Dye[] = ['ink', 'teal', 'plum', 'forest', 'ochre', 'rust'];

/**
 * The source chip's bookcloth: a theme keeps one dye on every pill (picked from its
 * name, since a pill does not know the whole shelf's palette); without a theme the
 * kind's dye, as the library colours spines by kind.
 */
export function documentDye(document: Pick<PillDocument, 'genre' | 'theme'>): string {
  if (document.theme) return DYES[THEME_DYES[hash(document.theme) % THEME_DYES.length] ?? 'stone'];
  const kind = FIXED_BUCKETS.kind.find((b) => b.value === document.genre);
  return DYES[kind?.dye ?? 'slate'];
}

// ---- Labels -----------------------------------------------------------------------------

export const KIND_LABELS: Record<PillKind, string> = {
  insight: 'Insight',
  remember: 'Remember',
  antipattern: 'Pitfall',
  quote: 'Quote',
  definition: 'Definition',
  number: 'Number',
  figure: 'Figure',
  diagram: 'Diagram',
  quiz: 'Quiz',
  flip: 'Flashcard',
  claim: 'Claim',
  math: 'Formula',
  connection: 'Connection',
  listen: 'Listen',
  hook: 'Hook',
  review: 'Review',
};

export const MODE_LABELS: Record<FeedMode, { label: string; hint: string }> = {
  consolidate: { label: 'Consolidate', hint: 'What you have read' },
  preview: { label: 'Preview', hint: 'The next chapters, as questions' },
  explore: { label: 'Explore', hint: 'Everything on the shelf' },
  review: { label: 'Review', hint: 'Only what is due' },
};

export function lengthLabel(length: number | null): string {
  return length === null ? 'Endless' : `${length} pills`;
}

// ---- Keys -------------------------------------------------------------------------------

export type FeedKey = 'next' | 'previous' | 'stepRight' | 'stepLeft' | 'save' | 'open' | 'confusing' | 'tooEasy' | 'end';

/** What a key does on the feed (docs/PILLS.md §9); null for every other key. */
export function feedKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): FeedKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
    case ' ':
      return 'next';
    case 'k':
    case 'ArrowUp':
      return 'previous';
    case 'ArrowRight':
      return 'stepRight';
    case 'ArrowLeft':
      return 'stepLeft';
    case 's':
      return 'save';
    case 'o':
      return 'open';
    case '?':
      return 'confusing';
    case 'e':
      return 'tooEasy';
    case 'Escape':
      return 'end';
    default:
      return null;
  }
}

/**
 * Keys typed into a field, or pressed inside a dialog or an audio player, are not the
 * feed's; nor is space on a button or link, which presses it.
 */
export function ownsKeys(target: EventTarget | null, key: string): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable || el.closest('input, textarea, select, dialog, audio, [contenteditable="true"]') !== null) return true;
  return (key === ' ' || key === 'Enter') && el.closest('button, a[href], summary') !== null;
}
