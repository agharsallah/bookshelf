import { describe, expect, it } from 'vitest';
import type { JobPublic } from '../../../lib/api/types/jobs';
import { knownVersions, liveSetJob, synthesisBlocks, synthesisCites, verdictsFor, versionParam } from './set';

const doc = (slug: string, title: string) => ({ id: `${slug}-id`, slug, title, authors: [] });

const body = {
  blocks: [
    { type: 'paragraph', spans: [{ text: 'Both gate passages.', cites: ['fid-light:ch01/p001', 'gated:ch01/p002'] }] },
    'junk',
  ],
  table: { type: 'table', header: ['Paper'], rows: [[{ text: 'Gated', cites: ['gated:fm01/p001'] }]] },
};
const sources = {
  'fid-light:ch01/p001': { document: doc('fid-light', 'FiD-light'), anchor: 'ch01/p001' },
  'gated:ch01/p002': { document: doc('gated', 'Gated adapters'), anchor: 'ch01/p002' },
  'gated:fm01/p001': { document: doc('gated', 'Gated adapters'), anchor: 'fm01/p001' },
};

describe('synthesisBlocks', () => {
  it('draws the blocks, then the at-a-glance table, skipping anything that is not a block', () => {
    expect(synthesisBlocks(body).map((b) => b.type)).toEqual(['paragraph', 'table']);
    expect(synthesisBlocks(null)).toEqual([]);
    expect(synthesisBlocks({ blocks: 'nope' as unknown as unknown[] })).toEqual([]);
  });
});

describe('synthesisCites', () => {
  const cites = synthesisCites({ body, sources });

  it('opens each cite in the right paper’s reader', () => {
    expect(cites.href('gated:ch01/p002')).toBe('/documents/gated/read/ch01/p002');
    expect(cites.href('fid-light:ch01/p001')).toBe('/documents/fid-light/read/ch01/p001');
  });

  it('letters papers in set order when the members are known', () => {
    const inSet = synthesisCites({ body, sources }, ['gated', 'fid-light']);
    expect(inSet.documents.map((d) => d.siglum + d.document.slug)).toEqual(['Agated', 'Bfid-light']);
    expect(inSet.label('gated:ch01/p002')).toBe('A 1 ¶2');
  });

  it('letters papers in the order the synthesis first cites them', () => {
    expect(cites.documents.map((d) => `${d.siglum} ${d.document.slug}`)).toEqual(['A fid-light', 'B gated']);
    expect(cites.label('gated:ch01/p002')).toBe('B 1 ¶2');
    expect(cites.title('gated:ch01/p002')).toBe('Gated adapters, ch01/p002');
  });

  it('still links a cite missing from sources by its slug', () => {
    expect(cites.href('other:ch02/p003')).toBe('/documents/other/read/ch02/p003');
  });
});

describe('knownVersions', () => {
  it('asks for the next version until there is none', async () => {
    const asked: number[] = [];
    const versions = await knownVersions(2, async (v) => {
      asked.push(v);
      return v <= 4;
    });
    expect(versions).toEqual([1, 2, 3, 4]);
    expect(asked).toEqual([3, 4, 5]);
  });

  it('stops at the limit', async () => {
    expect(await knownVersions(1, async () => true, 3)).toEqual([1, 2, 3, 4]);
  });
});

describe('versionParam', () => {
  it('takes a positive whole number only', () => {
    expect(versionParam('3')).toBe(3);
    expect(versionParam('0')).toBeNull();
    expect(versionParam('2.5')).toBeNull();
    expect(versionParam(null)).toBeNull();
  });
});

describe('verdictsFor', () => {
  it('offers the verdicts that change something', () => {
    expect(verdictsFor('draft')).toEqual(['approve', 'reject']);
    expect(verdictsFor('needs_review')).toEqual(['approve', 'reject']);
    expect(verdictsFor('approved')).toEqual(['reject']);
    expect(verdictsFor('rejected')).toEqual(['approve']);
  });
});

describe('liveSetJob', () => {
  const job = (id: string, setId: string, state: JobPublic['state'], created: string) =>
    ({ id, kind: 'synthesize_papers', state, payload: { set_id: setId }, created_at: created }) as unknown as JobPublic;

  it('finds the newest queued or running synthesis of this set', () => {
    const jobs = [job('a', 's1', 'done', '1'), job('b', 's1', 'queued', '2'), job('c', 's2', 'running', '3'), job('d', 's1', 'running', '4')];
    expect(liveSetJob(jobs, 's1')?.id).toBe('d');
    expect(liveSetJob(jobs, 's3')).toBeNull();
  });
});
