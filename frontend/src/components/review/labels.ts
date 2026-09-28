/**
 * Plain-language names for the review surfaces, and which job re-runs an artifact.
 * Everything a reviewer reads goes through here, so the vocabulary stays consistent.
 */
import type { ArtifactPublic, ArtifactType, Review } from '../../lib/api/types/artifacts';
import type { JobCreate, JobKind } from '../../lib/api/types/jobs';
import type { SkillPublic } from '../../lib/api/types/skills';
import { paramsOfVariant } from '../listen/listening';

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
  book_guide: 'Book guide',
  structured_note: 'Structured note',
  concept_links: 'Concept links',
  quote_set: 'Quotes',
  faq: 'FAQ',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
  glossary: 'Glossary',
  audio_summary: 'Audio summary script',
  salience_marks: 'What matters (marks)',
  paper_card: 'Paper card',
  paper_explainer: 'Paper explainer',
  claim_set: 'Claims',
  results_table: 'Results table',
  citation_intents: 'Citation intents',
  paper_assessment: 'Paper assessment',
  paper_review: 'Peer review',
  notation_table: 'Notation',
  journal_club: 'Journal club',
  math_explainer: 'Math, explained',
  catalogue_entry: 'Library card',
};

export const REVIEW_LABELS: Record<Review, string> = {
  needs_review: 'Needs review',
  draft: 'Draft',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * The job kind that produces each artifact type (§7). Derived artifacts (quiz, FAQ…)
 * come from `derive` with their skill's name; structured notes from `structure_note`
 * with their note's id.
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
  book_guide: 'derive',
  concept_links: 'link_concepts',
  structured_note: 'structure_note',
  quote_set: 'derive',
  faq: 'derive',
  quiz: 'derive',
  flashcards: 'derive',
  glossary: 'derive',
  audio_summary: 'derive',
  salience_marks: 'derive',
  paper_card: 'dissect_paper',
  paper_explainer: 'derive',
  claim_set: 'derive',
  results_table: 'derive',
  citation_intents: 'derive',
  paper_assessment: 'derive',
  paper_review: 'derive',
  notation_table: 'derive',
  journal_club: 'derive',
  math_explainer: 'derive',
  catalogue_entry: 'derive',
};

/**
 * The `POST /jobs` body (sent with `force`) that regenerates this artifact's scope, or
 * null when nothing can: a hand-written derived artifact names no skill, a structured
 * note without its note id has nothing to structure, and outline overrides are not jobs.
 */
export function rerunRequest(
  artifact: Pick<ArtifactPublic, 'type' | 'skill' | 'document_id' | 'anchor' | 'note_id' | 'variant'>,
  skills: readonly SkillPublic[] = [],
): JobCreate | null {
  const declared = skills.find((s) => s.name === artifact.skill)?.job_kind;
  const kind: JobKind | null = declared ?? PRODUCER[artifact.type] ?? null;
  if (!kind) return null;
  const scope = { kind, document_id: artifact.document_id, anchor: artifact.anchor };
  if (kind === 'derive') {
    if (!artifact.skill) return null;
    // An episode re-runs as itself: the same length, format and language.
    const params =
      artifact.type === 'audio_summary'
        ? paramsOfVariant(artifact.variant)
        : artifact.type === 'paper_explainer' && artifact.variant
          ? { level: artifact.variant }
          : null;
    return { ...scope, skill: artifact.skill, ...(params ? { params } : {}) };
  }
  if (kind === 'structure_note') return artifact.note_id ? { ...scope, note_id: artifact.note_id } : null;
  return scope;
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
    case 'paper_card':
      return 'The paper is marked distilled; its explainer and indexing are queued.';
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
