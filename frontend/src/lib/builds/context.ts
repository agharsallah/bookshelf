/**
 * What the planner and the agent read (docs/BUILDS.md §7), as data: which sections of the
 * paper brief go in, the references you add, and the one-line summary the collapsed
 * "What the agent will read" disclosure shows.
 */
import {
  CONTEXT_SECTION_KEYS,
  type BuildContextOptions,
  type BuildReference,
  type ContextSection,
  type ContextSectionKey,
  type ReferenceSource,
  type SuggestedReference,
} from '../api/types/builds';

export const CONTEXT_LIMITS = {
  notes: 8000,
  references: 20,
  refTitle: 200,
  refNote: 500,
} as const;

/** Groups of suggestions, in the order the editor lists them. */
export const SOURCE_LABELS: Record<ReferenceSource, string> = {
  code: 'Official code',
  data: 'Data',
  paper: 'This paper',
  cited: 'Cited works',
  shelf: 'On your shelf',
};

/** `1840` → `1 840` (a narrow no-break space groups the thousands). */
export const formatCount = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** `options.context`: null sections when none is switched off (the backend keeps them all). */
export function contextOptions(off: readonly ContextSectionKey[], notes: string): BuildContextOptions {
  return {
    sections: off.length ? CONTEXT_SECTION_KEYS.filter((k) => !off.includes(k)) : null,
    notes: notes.trim() || null,
  };
}

/** Sections switched on among those the paper has. */
export const sectionsOn = (sections: readonly ContextSection[], off: readonly ContextSectionKey[]) => sections.filter((s) => !off.includes(s.key));

export interface ContextState {
  /** null until the preview has loaded (or when it failed). */
  sections: readonly ContextSection[] | null;
  off: readonly ContextSectionKey[];
  references: readonly BuildReference[];
  notes: string;
}

/** `Paper brief · 1 840 words · 7 of 9 sections · 3 references · notes`. */
export function contextSummary({ sections, off, references, notes }: ContextState): string {
  const parts = ['Paper brief'];
  if (sections) {
    const on = sectionsOn(sections, off);
    parts.push(plural(on.reduce((n, s) => n + s.words, 0), 'word'));
    parts.push(on.length === sections.length ? `all ${sections.length} sections` : `${on.length} of ${sections.length} sections`);
  } else if (off.length) {
    parts.push(`${plural(off.length, 'section')} off`);
  }
  if (references.length) parts.push(plural(references.length, 'reference'));
  if (notes.trim()) parts.push('notes');
  return parts.join(' · ');
}

/** True when nothing in the context differs from what a new build starts with. */
export const isDefaultContext = (c: Pick<ContextState, 'off' | 'references' | 'notes'>) => c.off.length === 0 && c.references.length === 0 && !c.notes.trim();

/** An http(s) URL, or why not. */
export function validateUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return 'Paste a link.';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'Only http and https links.';
  } catch {
    return 'That is not a link: it should start with https://';
  }
}

/** `https://www.github.com/a/b` → `github.com`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A link reference; a blank title becomes the link's host. Snapshotted unless you say otherwise. */
export function linkReference(url: string, title: string, note: string, snapshot = true): BuildReference {
  const clean = url.trim();
  return { kind: 'url', url: clean, document_id: null, title: (title.trim() || hostOf(clean)).slice(0, CONTEXT_LIMITS.refTitle), note: note.trim() || null, snapshot };
}

export function shelfReference(documentId: string, title: string): BuildReference {
  return { kind: 'shelf', url: null, document_id: documentId, title: title.slice(0, CONTEXT_LIMITS.refTitle), note: null, snapshot: false };
}

export function fromSuggestion(s: SuggestedReference): BuildReference {
  return s.kind === 'shelf' && s.document_id ? shelfReference(s.document_id, s.title) : linkReference(s.url ?? '', s.title, '');
}

/** The same link or the same shelf paper. */
export function sameReference(a: Pick<BuildReference, 'kind' | 'url' | 'document_id'>, b: Pick<BuildReference, 'kind' | 'url' | 'document_id'>): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'shelf' ? a.document_id === b.document_id : (a.url ?? '').replace(/\/$/, '') === (b.url ?? '').replace(/\/$/, '');
}

export const isAdded = (refs: readonly BuildReference[], candidate: Pick<BuildReference, 'kind' | 'url' | 'document_id'>) => refs.some((r) => sameReference(r, candidate));

/** Suggestions grouped by where they come from, empty groups left out. */
export function groupSuggestions(list: readonly SuggestedReference[]): { source: ReferenceSource; label: string; items: SuggestedReference[] }[] {
  return (Object.keys(SOURCE_LABELS) as ReferenceSource[])
    .map((source) => ({ source, label: SOURCE_LABELS[source], items: list.filter((s) => s.source === source) }))
    .filter((g) => g.items.length > 0);
}

/** The first problem with the references, if any. */
export function validateReferences(refs: readonly BuildReference[]): string | null {
  if (refs.length > CONTEXT_LIMITS.references) return `At most ${CONTEXT_LIMITS.references} references.`;
  if (refs.some((r) => !r.title.trim())) return 'Every reference needs a title.';
  if (refs.some((r) => r.title.length > CONTEXT_LIMITS.refTitle)) return `Titles at most ${CONTEXT_LIMITS.refTitle} characters.`;
  if (refs.some((r) => (r.note ?? '').length > CONTEXT_LIMITS.refNote)) return `Notes at most ${CONTEXT_LIMITS.refNote} characters each.`;
  return null;
}

/** References as sent: notes trimmed, a blank note null, no snapshot for a shelf paper. */
export const referencesOut = (refs: readonly BuildReference[]): BuildReference[] =>
  refs.map((r) => ({ ...r, title: r.title.trim(), note: r.note?.trim() || null, snapshot: r.kind === 'url' && r.snapshot }));
