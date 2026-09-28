import { describe, expect, it } from 'vitest';
import type { ReadingCandidatePublic } from '../../../lib/api/types/papers';
import {
  bySource,
  candidatesQuery,
  canIngest,
  fetchedDocument,
  moveTarget,
  movesFor,
  nextHref,
  parseNextFilters,
  reasonCites,
  sourceChips,
  undoTarget,
} from './candidates';

const DOC = '0b8e7f6a-5d4c-4b3a-8291-0f1e2d3c4b5a';
const shelf = { [DOC]: { slug: 'moe', title: 'Mixture of Experts' } };

describe('filters', () => {
  it('round-trip through the URL and drop unknown values', () => {
    const f = parseNextFilters(new URLSearchParams('status=dismissed&source=watch'));
    expect(f).toEqual({ status: 'dismissed', source: 'watch' });
    expect(nextHref(f)).toBe('/papers/next?status=dismissed&source=watch');
    expect(parseNextFilters(new URLSearchParams('status=bogus&source=x'))).toEqual({ status: 'live', source: null });
    expect(nextHref({ status: 'live', source: null })).toBe('/papers/next');
  });

  it('asks the API for the live queue by leaving the status out', () => {
    expect(candidatesQuery({ status: 'live', source: null })).toEqual({ limit: 100 });
    expect(candidatesQuery({ status: 'queued', source: null })).toEqual({ status: 'queued', limit: 100 });
  });

  it('keeps candidates reached through the chosen source', () => {
    const items = [
      { id: 'a', sources: [{ kind: 'reference' as const, document_id: DOC }] },
      { id: 'b', sources: [{ kind: 'watch' as const, document_id: null }] },
    ];
    expect(bySource(items, 'watch').map((c) => c.id)).toEqual(['b']);
    expect(bySource(items, null)).toHaveLength(2);
  });
});

describe('sourceChips', () => {
  it('makes one chip per kind naming the shelf papers behind it', () => {
    const chips = sourceChips(
      [
        { kind: 'cited_by', document_id: DOC },
        { kind: 'reference', document_id: DOC },
        { kind: 'reference', document_id: 'gone' },
      ],
      shelf,
    );
    expect(chips.map((c) => c.kind)).toEqual(['reference', 'cited_by']);
    expect(chips[0]?.via).toEqual(['Mixture of Experts']);
  });
});

describe('reasonCites', () => {
  it('opens each cite in its paper’s reader, once', () => {
    const cites = reasonCites([`${DOC}#ch03/p002`, `${DOC}#ch03/p002`], shelf);
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({ href: '/documents/moe/read/ch03/p002', label: '3 ¶2', title: 'Mixture of Experts, ch03/p002' });
  });

  it('keeps a cite into a paper no longer on the shelf, without a link', () => {
    expect(reasonCites(['nope#ch01/p001'], shelf)[0]?.href).toBeNull();
  });
});

describe('status moves', () => {
  it('offers queue and dismiss on a suggestion, restore on a dismissal, nothing once ingested', () => {
    expect(movesFor('suggested')).toEqual(['queue', 'dismiss']);
    expect(movesFor('queued')).toEqual(['unqueue', 'dismiss']);
    expect(movesFor('dismissed')).toEqual(['restore']);
    expect(movesFor('ingested')).toEqual([]);
  });

  it('maps a move to the status it asks for, refusing a move that does not fit', () => {
    expect(moveTarget('suggested', 'queue')).toBe('queued');
    expect(moveTarget('queued', 'unqueue')).toBe('suggested');
    expect(moveTarget('dismissed', 'restore')).toBe('suggested');
    expect(moveTarget('dismissed', 'queue')).toBeNull();
    expect(moveTarget('ingested', 'dismiss')).toBeNull();
  });

  it('undoes a dismissal back to where it was', () => {
    expect(undoTarget('queued')).toBe('queued');
    expect(undoTarget('ingested')).toBeNull();
  });
});

describe('ingest', () => {
  const base = { arxiv_id: null, pdf_url: null, status: 'suggested' } satisfies Pick<ReadingCandidatePublic, 'arxiv_id' | 'pdf_url' | 'status'>;
  it('needs an arXiv id or an open-access PDF', () => {
    expect(canIngest(base)).toBe(false);
    expect(canIngest({ ...base, arxiv_id: '1706.03762' })).toBe(true);
    expect(canIngest({ ...base, pdf_url: 'https://x/y.pdf', status: 'ingested' })).toBe(false);
  });

  it('reads the new document from the fetch job’s result', () => {
    expect(fetchedDocument({ document_id: DOC })).toBe(DOC);
    expect(fetchedDocument(null)).toBeNull();
    expect(fetchedDocument({ document_id: 3 })).toBeNull();
  });
});
