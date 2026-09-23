import { describe, expect, it } from 'vitest';
import type { CiteSource, SearchDocument } from '../../lib/api/types/search';
import { indexCites, siglum, splitCite } from './cites';

const meadows: SearchDocument = { id: 'm', slug: 'meadows', title: 'Thinking in Systems', authors: [] };
const senge: SearchDocument = { id: 's', slug: 'senge', title: 'The Fifth Discipline', authors: [] };

const sources: Record<string, CiteSource> = {
  'meadows:ch03/s02/p014': { document: meadows, anchor: 'ch03/s02/p014' },
  'meadows:ch01/p002': { document: meadows, anchor: 'ch01/p002' },
  'senge:ch05/p001': { document: senge, anchor: 'ch05/p001' },
};

describe('cross-document cites', () => {
  it('splits a qualified cite on the first colon', () => {
    expect([splitCite('meadows:ch03/p014'), splitCite('ch03/p014')]).toEqual([
      { slug: 'meadows', anchor: 'ch03/p014' },
      { slug: null, anchor: 'ch03/p014' },
    ]);
  });

  it('letters documents in the order the answer first cites them', () => {
    const index = indexCites(sources, ['senge:ch05/p001', 'meadows:ch01/p002']);
    expect(index.documents.map((d) => [d.siglum, d.document.slug, d.cites.map((c) => c.anchor)])).toEqual([
      ['A', 'senge', ['ch05/p001']],
      ['B', 'meadows', ['ch01/p002', 'ch03/s02/p014']],
    ]);
  });

  it('resolves a cite to a reader deep link in its own document, labelled with the siglum', () => {
    const index = indexCites(sources, ['meadows:ch03/s02/p014']);
    expect(index.href('senge:ch05/p001')).toBe('/documents/senge/read/ch05/p001');
    expect(index.label('meadows:ch03/s02/p014')).toBe('A 3.2 ¶14');
    expect(index.title('senge:ch05/p001')).toBe('The Fifth Discipline, ch05/p001');
  });

  it('still links a qualified cite missing from the sources map by its slug', () => {
    expect(indexCites(sources).href('dennett:ch02/p003')).toBe('/documents/dennett/read/ch02/p003');
  });

  it('resolves bare anchors only when the answer draws on one document, and drops the siglum then', () => {
    const single = indexCites({ 'meadows:ch01/p002': sources['meadows:ch01/p002']! });
    expect([single.href('ch01/p002'), single.label('meadows:ch01/p002')]).toEqual(['/documents/meadows/read/ch01/p002', '1 ¶2']);
    expect(indexCites(sources).href('ch01/p002')).toBe('#ch01/p002');
  });

  it('continues sigla past Z', () => {
    expect([siglum(0), siglum(25), siglum(26), siglum(27)]).toEqual(['A', 'Z', 'AA', 'AB']);
  });
});
