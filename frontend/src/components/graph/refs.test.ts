import { describe, expect, it } from 'vitest';
import { graphHref, parseRef, refFromPath, viewFromParams } from './refs';

const DOC = '3f1c2b8e-2c4a-4d8e-9a53-0d1f1e0b7c11';

describe('graph refs in URLs', () => {
  it.each([
    [`concept:${DOC}`, `/graph/concept/${DOC}`],
    [`document:${DOC}`, `/graph/document/${DOC}`],
    [`node:${DOC}#ch03/s02/p014`, `/graph/node/${DOC}/ch03/s02/p014`],
  ])('round-trips %s through its path', (ref, path) => {
    expect(graphHref(ref)).toBe(path);
    expect(refFromPath(path.slice('/graph/'.length))).toBe(ref);
  });

  it('adds depth and proposed only when they differ from the defaults', () => {
    expect([graphHref(`concept:${DOC}`, { depth: 2, proposed: true }), graphHref(`concept:${DOC}`, { depth: 1 })]).toEqual([
      `/graph/concept/${DOC}?depth=2&proposed=1`,
      `/graph/concept/${DOC}`,
    ]);
    expect(viewFromParams(new URLSearchParams('depth=2&proposed=1'))).toEqual({ depth: 2, proposed: true });
    expect(viewFromParams(new URLSearchParams('depth=7'))).toEqual({ depth: 1, proposed: false });
  });

  it('accepts a bare id and rejects malformed paths', () => {
    expect([refFromPath(DOC), refFromPath('planet/x'), refFromPath(`node/${DOC}`), refFromPath(`concept/${DOC}/extra`)]).toEqual([
      DOC,
      null,
      null,
      null,
    ]);
  });

  it('parses a passage ref into its document and anchor', () => {
    expect(parseRef(`node:${DOC}#ch01/p002`)).toEqual({ kind: 'node', id: `${DOC}#ch01/p002`, documentId: DOC, anchor: 'ch01/p002' });
    expect([parseRef('node:nohash'), parseRef('bogus:1')]).toEqual([null, null]);
  });
});
