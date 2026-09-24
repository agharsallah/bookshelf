import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ConceptSummary } from '../../lib/api/types/graph';
import { fakeApi } from '../review/testing/fakeApi';
import { ConceptBrowser } from './ConceptBrowser';

const concept = (id: string, canonical: string, edge_count: number): ConceptSummary => ({
  id, canonical, edge_count, aliases: [], kind: 'concept', blurb: null, merged_into: null, origin: 'skill',
});
const page = (items: ConceptSummary[]) => ({ items, total: items.length, limit: 40, offset: 0 });

describe('<ConceptBrowser>', () => {
  it('orders by most connected on request and shows how linked each concept is', async () => {
    const { api, calls } = fakeApi({ 'GET concepts': () => page([concept('b', 'balancing loop', 7), concept('a', 'archetype', 1)]) });
    render(<ConceptBrowser initial={page([concept('a', 'archetype', 1)])} api={api} debounceMs={0} />);
    expect(screen.getByText('1 link')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Most connected' }));

    await waitFor(() => expect(calls.at(-1)?.query).toMatchObject({ sort: 'connected' }));
    expect(await screen.findByText('7 links')).toBeTruthy();
    expect(screen.getByText('2 concepts, most connected first')).toBeTruthy();
  });
});
