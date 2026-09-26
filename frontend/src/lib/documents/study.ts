/**
 * Study material: what a book (or one chapter) became, as a reader sees it. Each kind
 * names the artifact it is drawn from, what to call it, what one item of it is, and
 * where it opens: the brief and guide have their own pages; the rest open on the study
 * page (`/documents/{slug}/study/{kind}`, `?chapter=ch03` for one chapter's set).
 */
import type { ArtifactListItem, ArtifactType } from '../api/types/artifacts';
import { pickBest, type Standing } from './artifacts';

export const STUDY_KINDS = ['flashcards', 'quiz', 'faq', 'quotes', 'glossary'] as const;
export type StudyKind = (typeof STUDY_KINDS)[number];

export interface StudyMaterial {
  kind: StudyKind | 'brief' | 'guide';
  type: ArtifactType;
  label: string;
  /** What it lets you do, in a few words, for tiles. */
  hint: string;
  /** Book-wide only (brief, guide) or also per chapter. */
  bookOnly: boolean;
}

export const MATERIALS: readonly StudyMaterial[] = [
  { kind: 'brief', type: 'book_brief', label: 'Brief', hint: 'The book on one page', bookOnly: true },
  { kind: 'guide', type: 'book_guide', label: 'Book guide', hint: 'Chapter by chapter, with charts', bookOnly: true },
  { kind: 'flashcards', type: 'flashcards', label: 'Flashcards', hint: 'Turn cards, mark what you knew', bookOnly: false },
  { kind: 'quiz', type: 'quiz', label: 'Quiz', hint: 'Check yourself, with explanations', bookOnly: false },
  { kind: 'faq', type: 'faq', label: 'FAQ', hint: 'Questions a colleague would ask', bookOnly: false },
  { kind: 'quotes', type: 'quote_set', label: 'Quotes', hint: 'Lines worth keeping, verbatim', bookOnly: false },
  { kind: 'glossary', type: 'glossary', label: 'Glossary', hint: 'Every term, defined', bookOnly: true },
];

export function isStudyKind(value: string | undefined): value is StudyKind {
  return (STUDY_KINDS as readonly string[]).includes(value ?? '');
}

export function materialOf(kind: StudyKind | 'brief' | 'guide'): StudyMaterial {
  const material = MATERIALS.find((m) => m.kind === kind);
  if (!material) throw new Error(`Unknown study material: ${kind}`);
  return material;
}

/** Where a material opens, for the book or one chapter. */
export function studyHref(slug: string, kind: StudyMaterial['kind'], chapter: string | null = null): string {
  if (kind === 'brief' || kind === 'guide') return `/documents/${slug}/${kind}`;
  return `/documents/${slug}/study/${kind}${chapter ? `?chapter=${encodeURIComponent(chapter)}` : ''}`;
}

export interface AvailableMaterial extends StudyMaterial {
  href: string;
  /** The version shown: approved, else the newest draft (badged as one). */
  standing: Standing;
  artifactId: string;
}

/**
 * The study material that exists for a scope (`chapter` null: the whole book), in the
 * order readers meet it. Rejected versions never count.
 */
export function availableMaterials(slug: string, artifacts: readonly ArtifactListItem[], chapter: string | null = null): AvailableMaterial[] {
  return MATERIALS.filter((m) => chapter === null || !m.bookOnly).flatMap((material) => {
    const best = pickBest(artifacts, material.type, chapter);
    return best
      ? [{ ...material, href: studyHref(slug, material.kind, chapter), standing: best.standing, artifactId: best.artifact.id }]
      : [];
  });
}
