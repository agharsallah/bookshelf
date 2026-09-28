/** Test data for the library's tests: a DocumentSummary with only what matters overridden. */
import type { DocumentSummary } from '../../lib/api/types/documents';

export function summary(slug: string, over: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: `id-${slug}`,
    kind: 'pdf',
    genre: 'book',
    slug,
    title: `Title ${slug}`,
    authors: [],
    year: null,
    source_uri: null,
    source_path: null,
    sha256: slug,
    page_count: 200,
    language: 'en',
    status: 'linked',
    parse_tier: 1,
    tags: [],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    counts: { chapters: 10, blocks: 100, figures: 0, notes: 0 },
    artifacts: { draft: 0, needs_review: 0, approved: 0, rejected: 0 },
    latest_job: null,
    blurb: null,
    paused: null,
    ...over,
  };
}
