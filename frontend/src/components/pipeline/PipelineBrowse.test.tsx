import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import { fakeApi } from '../review/testing/fakeApi';
import { PipelineView } from './PipelineView';

function job(overrides: Partial<JobPublic>): JobPublic {
  return {
    id: 'j1', kind: 'parse', document_id: 'd1', anchor: null, skill: null, skill_version: null, state: 'done', attempts: 1,
    error: null, result: null, run_mode: null, duration_ms: 10, created_at: '2026-09-23T10:00:00Z', started_at: null, finished_at: '2026-09-23T10:00:01Z',
    ...overrides,
  };
}

const attention = { id: 'd1', slug: 'attention', title: 'Attention Is All You Need', status: 'distilling' };
const ddia = { id: 'd2', slug: 'ddia', title: 'Designing Data-Intensive Applications', status: 'linked' };
const region = (name: RegExp) => screen.getByRole('region', { name });
const queuedJobs = (n: number) => Array.from({ length: n }, (_, i) => job({ id: `q${i}`, kind: 'summarize', state: 'queued', finished_at: null, queue_position: i + 1 }));

afterEach(() => window.history.replaceState(null, '', '/'));

describe('<PipelineView> on a long queue', () => {
  it('finds jobs by the words of a book title and keeps the search in the address bar', async () => {
    const jobs = [job({ id: 'a', state: 'queued', queue_position: 1 }), job({ id: 'b', document_id: 'd2', kind: 'embed', state: 'queued', queue_position: 2 })];
    render(<PipelineView jobs={jobs} documents={[attention, ddia]} api={fakeApi().api} live={false} />);

    await userEvent.type(screen.getByRole('searchbox'), 'data intensive');

    const queued = region(/^Queued/);
    expect(within(queued).getByText('Designing Data-Intensive Applications')).toBeTruthy();
    expect(within(queued).queryByText('Attention Is All You Need')).toBeNull();
    expect(screen.getByText(/1 of 2 jobs/)).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('q')).toBe('data intensive');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(within(queued).getByText('Attention Is All You Need')).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it('lists queued jobs in the order they start, a page at a time', async () => {
    render(<PipelineView jobs={queuedJobs(45).reverse()} documents={[attention]} api={fakeApi().api} live={false} />);
    const queued = region(/^Queued/);
    const places = () => within(queued).getAllByText(/Queued, /).map((el) => el.textContent?.split(' · ')[0]);

    expect(places()).toHaveLength(20);
    expect(places()[0]).toBe('Queued, next in line');
    expect(within(queued).getByText('Showing 20 of 45 queued jobs.')).toBeTruthy();

    await userEvent.click(within(queued).getByRole('button', { name: 'Show 20 more' }));
    expect(places()).toHaveLength(40);
    await userEvent.click(within(queued).getByRole('button', { name: 'Show 5 more' }));
    expect(places()).toHaveLength(45);
    expect(within(queued).queryByRole('button', { name: /more/ })).toBeNull();
  });

  it('shows only documents with live or failed work until asked for all of them', async () => {
    render(<PipelineView jobs={[job({ id: 'a', state: 'failed' }), job({ id: 'b', document_id: 'd2' })]} documents={[attention, ddia]} api={fakeApi().api} live={false} />);
    const docs = region(/^Documents/);

    expect(within(docs).getByText('Attention Is All You Need')).toBeTruthy();
    expect(within(docs).queryByText('Designing Data-Intensive Applications')).toBeNull();

    await userEvent.click(within(docs).getByRole('button', { name: 'All 2' }));
    expect(within(docs).getByText('Designing Data-Intensive Applications')).toBeTruthy();
  });

  it('filters to a kind from its bar, and back', async () => {
    render(<PipelineView jobs={[job({ id: 'a' }), job({ id: 'b', kind: 'embed' })]} documents={[attention]} api={fakeApi().api} live={false} />);
    const kinds = region(/By kind/);

    await userEvent.click(within(kinds).getByRole('button', { name: 'Embed' }));
    expect(within(region(/Recently finished/)).queryByText('Parse')).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Kind' }) as HTMLSelectElement).value).toBe('embed');

    await userEvent.click(within(kinds).getByRole('button', { name: 'Embed' }));
    expect(within(region(/Recently finished/)).getByText('Parse')).toBeTruthy();
  });

  it('puts a document first in the queue from its row', async () => {
    const queue = { workers: [], queued: 1, running: 0, unclaimed_kinds: [], paused: false, max_running: null, slots: 2, first_documents: [] };
    const { api, calls } = fakeApi({ 'PATCH jobs/queue': (call) => ({ ...queue, ...(call.body as object) }) });
    render(<PipelineView jobs={[job({ id: 'a', state: 'queued', queue_position: 1 })]} documents={[attention]} queue={queue} api={api} live={false} />);

    await userEvent.click(within(region(/^Documents/)).getByRole('button', { name: 'Put Attention Is All You Need first in the queue' }));

    expect(calls.map((c) => c.body)).toEqual([{ first_documents: ['d1'] }]);
    expect(await within(region(/^Documents/)).findByRole('button', { name: 'Stop putting Attention Is All You Need first in the queue' })).toBeTruthy();
  });

  it('opens with the filters the address asks for', () => {
    render(<PipelineView jobs={[job({ id: 'a' }), job({ id: 'b', state: 'failed' })]} documents={[attention]} initialFilters={{ state: 'failed' }} api={fakeApi().api} live={false} />);
    expect(screen.getByText('Nothing finished yet.')).toBeTruthy();
  });
});
