/** Paper shapes for tests (the backend's wire shapes, filled with plausible values). */
import type { PaperArtifactState, PaperDetail, PaperRatingPublic } from '../../lib/api/types/papers';

export function artifactState(overrides: Partial<PaperArtifactState> = {}): PaperArtifactState {
  return { type: 'paper_card', variant: null, artifact_id: 'a1', review: 'approved', created_at: '2026-09-01T10:00:00Z', ...overrides };
}

export function rating(overrides: Partial<PaperRatingPublic> = {}): PaperRatingPublic {
  return { id: 'r1', document_id: 'd1', stars: 4, verdict: 'useful', note: null, created_at: '2026-09-02T10:00:00Z', ...overrides };
}

export function paperDetail(overrides: Partial<PaperDetail> = {}): PaperDetail {
  return {
    id: 'd1',
    slug: 'attention-is-all-you-need',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit'],
    year: 2017,
    status: 'distilled',
    venue: 'NeurIPS',
    doi: null,
    arxiv_id: '1706.03762',
    openalex_id: 'W2963403868',
    cited_by_count: 120000,
    meta_source: 'openalex',
    rating: null,
    highest_pass: null,
    artifacts: [],
    counts: { references: 40, references_on_shelf: 2, claims: 0 },
    created_at: '2026-09-01T09:00:00Z',
    meta: null,
    passes: [],
    ...overrides,
  };
}
