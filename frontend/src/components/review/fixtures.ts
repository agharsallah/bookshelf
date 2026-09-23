/** Test data builder for artifacts: sensible defaults, override what the test is about. */
import type { ArtifactListItem } from '../../lib/api/types/artifacts';

let counter = 0;

export function artifact(overrides: Partial<ArtifactListItem> = {}): ArtifactListItem {
  counter += 1;
  return {
    id: `a${counter}`,
    document_id: 'doc1',
    anchor: 'ch01/s01',
    note_id: null,
    type: 'section_note',
    version: 1,
    origin: 'skill',
    skill: 'distil-section',
    skill_version: '1',
    model: 'claude-sonnet',
    run_mode: 'batch',
    tier: 'distil',
    input_hash: 'f'.repeat(64),
    body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Stocks change through flows.', cites: ['ch01/s01/p001'] }] }] },
    citations: ['ch01/s01/p001'],
    gates: { grounding: 1, compression: 0.18, words: 5, flags: [], schema_retry: false },
    review: 'draft',
    reviewed_at: null,
    created_at: '2026-09-20T10:00:00Z',
    ...overrides,
  };
}
