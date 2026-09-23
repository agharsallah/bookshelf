/**
 * Plain-language names for the review surfaces, and which job re-runs an artifact.
 * Everything a reviewer reads goes through here, so the vocabulary stays consistent.
 */
import type { ArtifactPublic, ArtifactType, Review } from '../../lib/api/types/artifacts';
import type { JobKind } from '../../lib/api/types/jobs';
import type { SkillPublic } from '../../lib/api/types/skills';

export const TYPE_LABELS: Record<ArtifactType, string> = {
  outline_override: 'Outline',
  figure_description: 'Figure description',
  code_explanation: 'Code explanation',
  math_description: 'Formula description',
  table_explanation: 'Table explanation',
  chapter_summary: 'Chapter summary',
  book_summary: 'Book summary',
  section_note: 'Section note',
  chapter_distillation: 'Chapter distillation',
  book_brief: 'Book brief',
  structured_note: 'Structured note',
  concept_links: 'Concept links',
  quote_set: 'Quotes',
  faq: 'FAQ',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  glossary: 'Glossary',
};

export const REVIEW_LABELS: Record<Review, string> = {
  needs_review: 'Needs review',
  draft: 'Draft',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * The job kind that produces each artifact type (§7). `derive` and `structure_note`
 * need a skill name or note id that `POST /jobs` cannot carry, so they are not re-runnable here.
 */
const PRODUCER: Partial<Record<ArtifactType, JobKind>> = {
  figure_description: 'describe_figure',
  code_explanation: 'explain_code',
  math_description: 'describe_math',
  table_explanation: 'explain_table',
  chapter_summary: 'summarize',
  book_summary: 'summarize',
  section_note: 'distil_section',
  chapter_distillation: 'distil_chapter',
  book_brief: 'brief',
  concept_links: 'link_concepts',
};

/** The job to enqueue (with `force`) to regenerate this artifact's scope, if any. */
export function rerunKind(
  artifact: Pick<ArtifactPublic, 'type' | 'skill'>,
  skills: readonly SkillPublic[] = [],
): JobKind | null {
  const declared = skills.find((s) => s.name === artifact.skill)?.job_kind;
  const kind = declared ?? PRODUCER[artifact.type] ?? null;
  return kind === 'derive' || kind === 'structure_note' ? null : kind;
}

/** What approving this artifact sets in motion upstream (§7 "approval propagates upward"). */
export function propagationNote(type: ArtifactType): string | null {
  switch (type) {
    case 'section_note':
      return 'The chapter distillation above this section will be regenerated from the approved note.';
    case 'chapter_distillation':
      return 'Once every chapter is approved, the book brief is regenerated.';
    case 'book_brief':
      return 'The book is marked distilled and queued for indexing.';
    case 'figure_description':
    case 'code_explanation':
    case 'math_description':
    case 'table_explanation':
      return 'The section note that contains this element can now cite it.';
    default:
      return null;
  }
}

/** `2 h ago`, `3 d ago`; absolute date past a month. `now` is injectable for tests. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** `skill@version` for a skill artifact, `by hand` for a human one. */
export function authorship(artifact: Pick<ArtifactPublic, 'origin' | 'skill' | 'skill_version'>): string {
  if (artifact.origin === 'human') return 'by hand';
  if (!artifact.skill) return 'skill';
  return artifact.skill_version ? `${artifact.skill}@${artifact.skill_version}` : artifact.skill;
}
