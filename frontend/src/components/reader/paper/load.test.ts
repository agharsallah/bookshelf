import { describe, expect, it, vi } from 'vitest';
import type { ArtifactPublic } from '../../../lib/api/types/artifacts';
import type { TreeNode } from '../../../lib/api/types/documents';
import { loadPaperReading } from './load';

const unit = (anchor: string, role?: string): TreeNode => ({
  id: anchor, anchor, kind: 'chapter', ordinal: 0, depth: 0, heading: anchor.toUpperCase(), text: null, page_from: 1, page_to: 1, meta: role ? { role } : {}, children: [],
});

const artifact = (type: ArtifactPublic['type'], body: Record<string, unknown>, review: ArtifactPublic['review'] = 'approved') =>
  ({ id: `${type}-1`, type, anchor: null, review, version: 1, body }) as unknown as ArtifactPublic;

describe('loadPaperReading', () => {
  it('gathers passes, roles, marks, the notation and the review questions', async () => {
    const get = vi.fn((path: string) => {
      if (path === 'papers/attention') return Promise.resolve({ passes: [{ document_id: 'd', pass: 1, completed_at: 'x', note: null }] });
      return Promise.resolve({ document_id: 'd', unit: 'ch03', marks: [{ anchor: 'ch03/p001', claims: [], supported_by: 0, contradicted_by: 0, extended_by: 0 }] });
    });
    const artifactsOf = vi.fn((type: 'notation_table' | 'paper_review') =>
      Promise.resolve(
        type === 'notation_table'
          ? [artifact('notation_table', { symbols: [{ symbol_latex: 'd_k', meaning: 'Key dimension.', first_anchor: 'ch03/s01/p001', cites: ['ch03/p001'] }] }, 'draft')]
          : [artifact('paper_review', { questions: [[{ text: 'Why scale by √d_k?', cites: ['ch03/p001'] }]] })],
      ),
    );
    const reading = await loadPaperReading({
      api: { get } as never,
      slug: 'attention',
      unit: 'ch03',
      units: [unit('ch01', 'abstract'), { ...unit('ch03'), children: [{ ...unit('ch03/s01'), kind: 'section', heading: '2.1 Scaled attention' }] }],
      artifactsOf,
      renderMath: (latex) => Promise.resolve(`<k>${latex}</k>`),
    });
    expect(get).toHaveBeenCalledWith('documents/attention/claims/marks', { query: { unit: 'ch03' } });
    expect(reading.passes.map((p) => p.pass)).toEqual([1]);
    expect(reading.units).toEqual([
      { anchor: 'ch01', heading: 'CH01', role: 'abstract' },
      { anchor: 'ch03', heading: 'CH03', role: null },
    ]);
    expect(reading.marks).toHaveLength(1);
    expect(reading.notation).toMatchObject({ standing: 'draft', symbols: [{ latex: 'd_k', html: '<k>d_k</k>', firstAnchor: 'ch03/s01/p001', firstPlace: '2.1 Scaled attention' }] });
    expect(reading.questions).toEqual([[{ text: 'Why scale by √d_k?', cites: ['ch03/p001'] }]]);
  });

  it('still reads when the paper calls fail or nothing was made yet', async () => {
    const reading = await loadPaperReading({
      api: { get: () => Promise.reject(new Error('down')) } as never,
      slug: 'attention',
      unit: 'ch01',
      units: [unit('ch01', 'abstract')],
      artifactsOf: () => Promise.reject(new Error('down')),
      renderMath: () => Promise.resolve(''),
    });
    expect(reading).toMatchObject({ passes: [], marks: [], notation: null, questions: [] });
  });
});
