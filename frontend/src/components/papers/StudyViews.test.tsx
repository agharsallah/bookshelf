import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ClaimPublic, ClaimRelation, ClaimRelations as Relations } from '../../lib/api/types/paperStudy';
import { CiteProvider } from '../blocks/CiteContext';
import { fakeApi } from '../review/testing/fakeApi';
import { ClaimRelations } from './ClaimRelations';
import { NotationTable } from './NotationTable';

const claim = (over: Partial<ClaimPublic> = {}): ClaimPublic => ({
  id: 'c1',
  document_id: 'd1',
  artifact_id: 'a1',
  key: 'C2',
  text: 'Gating improves EM by 2.1 on NQ.',
  kind: 'result',
  strength: 'measured',
  evidence: ['ch04/p001'],
  unit: 'ch04',
  ...over,
});

const relation = (over: Partial<ClaimRelation> = {}): ClaimRelation => ({
  edge_id: 'e1',
  relation: 'supports',
  direction: 'in',
  status: 'proposed',
  weight: 0.8,
  confidence: 'high',
  rationale: 'Both report gains from filtering passages.',
  other: claim({ id: 'c9', document_id: 'd2', key: 'C1', text: 'Filtering passages helps the reader.', strength: 'argued', kind: 'method' }),
  other_document: { id: 'd2', slug: 'fusion-in-decoder', title: 'Fusion-in-Decoder' },
  evidence: [
    { ref: 'd1#ch04/p001', document: { id: 'd1', slug: 'gra', title: 'GRA' }, anchor: 'ch04/p001', kind: 'paragraph', heading: 'Experiments', snippet: 'We report EM.', exists: true },
    { ref: 'd2#ch03/p002', document: { id: 'd2', slug: 'fusion-in-decoder', title: 'FiD' }, anchor: 'ch03/p002', kind: 'paragraph', heading: 'Method', snippet: null, exists: true },
  ],
  ...over,
});

const counts = { supported_by: 0, contradicted_by: 0, extended_by: 0, supports: 0, extends: 0, proposed: 1 };

describe('<ClaimRelations>', () => {
  it('opens onto the other paper’s claim and its evidence, and accepts a proposed relation', async () => {
    const body: Relations = { claim: claim(), document: { id: 'd1', slug: 'gra', title: 'GRA' }, relations: [relation()] };
    const { api, calls } = fakeApi({ 'GET claims/c1/relations': () => body, 'PATCH edges/e1': () => ({}) });
    const onCite = vi.fn();
    render(<ClaimRelations claimId="c1" counts={counts} documentId="d1" onCite={onCite} api={api} />);

    await userEvent.click(screen.getByRole('button', { name: /1 to review/ }));
    expect(await screen.findByText('Filtering passages helps the reader.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fusion-in-Decoder' }).getAttribute('href')).toBe('/documents/fusion-in-decoder/paper/claims');
    expect(screen.getByRole('link', { name: 'FiD, Method, 3 ¶2' }).getAttribute('href')).toBe('/documents/fusion-in-decoder/read/ch03/p002');

    await userEvent.click(screen.getByRole('link', { name: 'This paper, Experiments, 4 ¶1' }));
    expect(onCite).toHaveBeenCalledWith('ch04/p001');

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(calls.at(-1)).toEqual({ method: 'PATCH', path: 'edges/e1', body: { status: 'accepted' } });
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('drops a rejected relation from the list', async () => {
    const body: Relations = { claim: claim(), document: null, relations: [relation()] };
    const { api } = fakeApi({ 'GET claims/c1/relations': () => body, 'PATCH edges/e1': () => ({}) });
    render(<ClaimRelations claimId="c1" counts={counts} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: /to review/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('No relations left.')).toBeTruthy();
  });

  it('says so when nothing on the shelf bears on the claim, without asking the API', () => {
    const { api, calls } = fakeApi();
    render(<ClaimRelations claimId="c1" counts={{ ...counts, proposed: 0 }} api={api} />);
    expect(screen.getByText('Nothing on your shelf bears on it yet.')).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

describe('<NotationTable>', () => {
  const symbols = [
    { latex: '\\sigma', meaning: 'The logistic sigmoid.', firstAnchor: 'ch03/s01/m001', cites: [], html: '<span>σ</span>' },
    { latex: 'g_i', meaning: 'Gate score of passage i.', firstAnchor: 'ch03/s01/m001', cites: ['ch03/s01/p002'], html: '<span>gᵢ</span>' },
  ];

  it('filters by meaning and links each symbol to its first use through the cite context', async () => {
    const onCite = vi.fn();
    render(
      <CiteProvider value={{ citeHref: (a) => `/read/${a}`, onCite }}>
        <NotationTable symbols={symbols} />
      </CiteProvider>,
    );
    expect(screen.getByText('2 symbols')).toBeTruthy();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a symbol' }), 'gate');
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.queryByText('The logistic sigmoid.')).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: /First used at 3\.1\.1/ }));
    expect(onCite).toHaveBeenCalledWith('ch03/s01/m001');
  });

  it('names the first use by the paper’s own section heading when it is known', () => {
    render(
      <CiteProvider value={{ citeHref: (a) => `/read/${a}`, onCite: vi.fn() }}>
        <NotationTable symbols={[{ ...symbols[0]!, firstPlace: '2.1 Gating' }]} />
      </CiteProvider>,
    );
    expect(screen.getByRole('link', { name: /First used in 2\.1 Gating/ })).toBeTruthy();
    expect(screen.queryByText(/First used at/)).toBeNull();
  });
});
