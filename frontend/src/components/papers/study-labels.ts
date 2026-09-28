/**
 * Plain words for the study vocabularies: claim kinds and strengths, rubric criteria,
 * reproducibility items and statuses, reviewer recommendations, and the skills that
 * make each paper artifact (for the "make it now" buttons).
 */
import type { JobCreate } from '../../lib/api/types/jobs';
import type { AssessmentCriterion, ClaimStrength, ReproducibilityStatus } from '../../lib/api/types/papers';
import type { Recommendation, ReproducibilityItem } from '../../lib/api/types/paperStudy';

export const STRENGTH_LABELS: Record<ClaimStrength, { name: string; hint: string }> = {
  measured: { name: 'Measured', hint: 'Backed by the paper’s own experiments or tables.' },
  argued: { name: 'Argued', hint: 'Reasoned for, not measured.' },
  speculated: { name: 'Speculated', hint: 'Offered as a possibility.' },
};

export const CRITERION_LABELS: Record<AssessmentCriterion, string> = {
  novelty: 'Novelty',
  rigour: 'Rigour',
  evidence: 'Evidence',
  clarity: 'Clarity',
  reproducibility: 'Reproducibility',
  relevance: 'Relevance to your shelf',
};

export const ITEM_LABELS: Record<ReproducibilityItem, string> = {
  code: 'Code released',
  data: 'Data available',
  hyperparameters: 'Hyperparameters',
  seeds: 'Random seeds',
  compute: 'Compute budget',
  baselines: 'Baselines re-run',
  ablations: 'Ablations',
  statistical_significance: 'Significance tests',
  data_splits: 'Data splits',
  evaluation_protocol: 'Evaluation protocol',
};

export const STATUS_LABELS: Record<ReproducibilityStatus, string> = {
  yes: 'Reported',
  partial: 'Partly',
  no: 'Missing',
  unknown: 'Not said',
};

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  accept: 'Accept',
  weak_accept: 'Weak accept',
  borderline: 'Borderline',
  weak_reject: 'Weak reject',
  reject: 'Reject',
};

/** The skill that makes each study artifact (all `derive`, document scope). */
export const STUDY_SKILLS = {
  claims: 'extract-claims',
  results: 'extract-results',
  intents: 'classify-citations',
  assessment: 'assess-paper',
  review: 'review-paper',
  notation: 'make-notation',
  club: 'make-journal-club',
  math: 'explain-math',
} as const;

export function deriveRequest(documentId: string, skill: string): JobCreate {
  return { kind: 'derive', document_id: documentId, skill };
}
