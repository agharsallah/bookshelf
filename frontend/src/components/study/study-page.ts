/**
 * What the study pages need, worked out from the document's artifacts: the switcher
 * between the materials of this scope (shared with the brief and guide pages), the
 * chapters that have their own set, and the wording of the empty state.
 */
import type { ArtifactPublic, ArtifactType } from '../../lib/api/types/artifacts';
import { compareAnchors } from '../../lib/documents/artifacts';
import { MATERIALS, studyHref, type AvailableMaterial, type StudyKind } from '../../lib/documents/study';

export interface SwitchItem {
  kind: AvailableMaterial['kind'];
  label: string;
  href: string;
  current: boolean;
  /** The page you are on, when nothing exists for it yet. */
  missing: boolean;
}

/** The materials that exist, plus the current one even when it does not, in shelf order. */
export function switcherItems(
  slug: string,
  available: readonly AvailableMaterial[],
  kind: AvailableMaterial['kind'],
  chapter: string | null = null,
): SwitchItem[] {
  return MATERIALS.flatMap((material) => {
    const found = available.find((m) => m.kind === material.kind);
    const current = material.kind === kind;
    if (!found && !current) return [];
    return [{ kind: material.kind, label: material.label, href: found?.href ?? studyHref(slug, kind, chapter), current, missing: !found }];
  });
}

/** Chapters with their own set of `type` (any version not rejected), in book order. */
export function chapterScopes(artifacts: readonly ArtifactPublic[], type: ArtifactType): string[] {
  const anchors = new Set<string>();
  for (const a of artifacts) {
    if (a.type === type && a.anchor !== null && a.review !== 'rejected') anchors.add(a.anchor);
  }
  return [...anchors].sort(compareAnchors);
}

/** The `?chapter=` value as a scope: blank means the whole book. */
export function chapterParam(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

const NOUNS: Record<StudyKind, string> = {
  flashcards: 'flashcards',
  quiz: 'quiz',
  faq: 'FAQ',
  quotes: 'quotes',
  glossary: 'glossary',
};

/** "No flashcards yet for this book." */
export function emptyMessage(kind: StudyKind, chapter: string | null): string {
  return `No ${NOUNS[kind]} yet for this ${chapter ? 'chapter' : 'book'}.`;
}
