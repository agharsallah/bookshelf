/**
 * The TS vocabularies are hand-written mirrors of backend/app/models/enums.py (and build.py). This reads
 * the Python files (same repository) and fails when a value is added on one side only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_TYPES, REVIEW_STATES, TIERS } from './artifacts';
import { DOCUMENT_STATUSES, GENRES } from './documents';
import { CONCEPT_KINDS, EDGE_STATUSES, ENTITY_KINDS, RELATIONS } from './graph';
import { JOB_KINDS, JOB_STATES } from './jobs';
import {
  ASSESSMENT_CRITERIA,
  CANDIDATE_SOURCES,
  CANDIDATE_STATUSES,
  CITATION_INTENTS,
  CLAIM_KINDS,
  CLAIM_STRENGTHS,
  EXPLAINER_LEVELS,
  PAPER_META_SOURCES,
  PAPER_VERDICTS,
  REPRODUCIBILITY_STATUSES,
  SECTION_ROLES,
} from './papers';
import { BUILD_STATES, BUILD_VISIBILITIES, STOP_REASONS } from './builds';

const backend = (path: string) => readFileSync(new URL(`../../../../../backend/app/models/${path}`, import.meta.url), 'utf8');
// Most enums live in enums.py; the build vocabularies sit next to their model (size budget).
const source = [backend('enums.py'), backend('build.py')].join('\n');

/** `class Name(StrEnum):` → its member values, in declaration order. */
function pythonEnum(name: string): string[] {
  const start = source.indexOf(`class ${name}(`);
  if (start < 0) throw new Error(`the backend models have no class ${name}`);
  const next = source.indexOf('\nclass ', start + 1);
  const body = source.slice(start, next < 0 ? undefined : next);
  return [...body.matchAll(/^ {4}[A-Z][A-Z0-9_]*\s*=\s*"([^"]+)"/gm)].map((m) => m[1] ?? '');
}

const sorted = (values: readonly string[]) => [...values].sort();

const MIRRORS: [string, readonly string[]][] = [
  ['ArtifactType', ARTIFACT_TYPES],
  ['Review', REVIEW_STATES],
  ['Tier', TIERS],
  ['Genre', GENRES],
  ['DocumentStatus', DOCUMENT_STATUSES],
  ['ConceptKind', CONCEPT_KINDS],
  ['EntityKind', ENTITY_KINDS],
  ['Relation', RELATIONS],
  ['EdgeStatus', EDGE_STATUSES],
  ['JobKind', JOB_KINDS],
  ['JobState', JOB_STATES],
  ['PaperMetaSource', PAPER_META_SOURCES],
  ['CitationIntent', CITATION_INTENTS],
  ['ClaimKind', CLAIM_KINDS],
  ['ClaimStrength', CLAIM_STRENGTHS],
  ['PaperVerdict', PAPER_VERDICTS],
  ['CandidateStatus', CANDIDATE_STATUSES],
  ['CandidateSource', CANDIDATE_SOURCES],
  ['SectionRole', SECTION_ROLES],
  ['ExplainerLevel', EXPLAINER_LEVELS],
  ['AssessmentCriterion', ASSESSMENT_CRITERIA],
  ['ReproducibilityStatus', REPRODUCIBILITY_STATUSES],
  ['BuildState', BUILD_STATES],
  ['StopReason', STOP_REASONS],
  ['BuildVisibility', BUILD_VISIBILITIES],
];

describe('TS enum mirrors', () => {
  it('reads values out of enums.py', () => {
    expect(pythonEnum('Genre')).toEqual(['book', 'paper', 'article']);
  });

  it.each(MIRRORS)('%s has the same values as the backend', (name, mirror) => {
    expect(sorted(mirror)).toEqual(sorted(pythonEnum(name)));
  });
});
