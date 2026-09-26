import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeApi } from '../review/testing/fakeApi';
import { SearchPage } from './SearchPage';
import { RECENT_SEARCHES_KEY } from './recent';
import { emptySearch } from './url-state';

const doc = { id: 'm', slug: 'meadows', title: 'Thinking in Systems', authors: ['Donella Meadows'] };
const hits = {
  intent: 'lexical',
  took_ms: 4,
  groups: [{ document: doc, hits: [{ kind: 'block', anchor: 'ch01/p002', score: 1, snippet: 'a stock and a flow', highlights: [[2, 7]] }] }],
};

/** A fetch whose answer stream the test writes frame by frame. */
function streamingFetch() {
  let push: (text: string) => void = () => undefined;
  let finish: () => void = () => undefined;
  let signal: AbortSignal | undefined;
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    signal = init?.signal ?? undefined;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(encoder.encode(text));
        finish = () => controller.close();
        signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-9' } });
  };
  return { fetch, push: (t: string) => push(t), finish: () => finish(), aborted: () => signal?.aborted ?? false };
}

function renderPage(fetch: typeof globalThis.fetch) {
  const { api } = fakeApi({ 'POST search': () => hits });
  render(<SearchPage initial={{ ...emptySearch, q: 'why delays?' }} documents={[]} tags={[]} api={api} fetch={fetch} debounceMs={0} />);
}

describe('SearchPage', () => {
  it('shows the lexical hit with its matched words marked and a link into the reader', async () => {
    renderPage(streamingFetch().fetch);
    const mark = await screen.findByText('stock');
    expect(mark.tagName).toBe('MARK');
    expect(mark.closest('a')?.getAttribute('href')).toBe('/documents/meadows/read/ch01/p002');
  });

  it('opens a synthesis with where the books meet, each passage linking into the reader', async () => {
    const relation = { relation: 'contradicts', src: { id: 'r', canonical: 'reinforcing loop' }, dst: { id: 'b', canonical: 'balancing loop' }, weight: 0.6, evidence: ['meadows:ch01/p003'] };
    const { api } = fakeApi({ 'POST search': () => ({ ...hits, intent: 'synthesis', relations: [relation] }) });
    render(<SearchPage initial={{ ...emptySearch, q: 'how do they disagree?' }} documents={[]} tags={[]} api={api} debounceMs={0} />);
    const note = await screen.findByRole('region', { name: 'Where the books meet' });
    expect(note.textContent).toContain('reinforcing loop contradicts balancing loop');
    expect(within(note).getByRole('link', { name: '1 ¶3' }).getAttribute('href')).toBe('/documents/meadows/read/ch01/p003');
  });

  it.each([
    ['empty', /Nothing is indexed for search yet/],
    ['unavailable', /Meaning-based search is unavailable/],
  ])('explains an empty %s index and offers the exact-words search', async (indexState, message) => {
    const { api, calls } = fakeApi({ 'POST search': () => ({ intent: 'discovery', took_ms: 3, groups: [], index_state: indexState }) });
    render(<SearchPage initial={{ ...emptySearch, q: 'feedback' }} documents={[]} tags={[]} api={api} debounceMs={0} />);
    expect((await screen.findByRole('status')).textContent).toMatch(message);
    await userEvent.click(screen.getByRole('button', { name: 'search the exact words instead' }));
    await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ query: 'feedback', mode: 'lexical' }));
  });

  it('streams the answer: status first, then cited blocks linking into each book', async () => {
    const stream = streamingFetch();
    renderPage(stream.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Ask for an answer' }));
    stream.push('event: status\ndata: {"stage":"searching","message":"Searching (lexical)"}\n\n');
    expect(await screen.findByText('Searching (lexical)')).toBeTruthy();

    const answer = {
      blocks: [{ type: 'paragraph', spans: [{ text: 'Delays cause oscillation.', cites: ['meadows:ch01/p002'] }] }],
      sources: { 'meadows:ch01/p002': { document: doc, anchor: 'ch01/p002' } },
      dropped_cites: [],
      model: 'm',
    };
    stream.push(`event: answer\ndata: ${JSON.stringify(answer)}\n\n`);
    stream.finish();
    expect(await screen.findByText('Delays cause oscillation.')).toBeTruthy();
    const chip = screen.getByRole('link', { name: /, source Thinking in Systems, ch01\/p002$/ });
    expect(chip.getAttribute('href')).toBe('/documents/meadows/read/ch01/p002');
    expect(screen.queryByText('Searching (lexical)')).toBeNull();
  });

  it('stops the stream when cancelled', async () => {
    const stream = streamingFetch();
    renderPage(stream.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Ask for an answer' }));
    stream.push('event: status\ndata: {"stage":"writing","message":"Writing a cited answer"}\n\n');
    await screen.findByText('Writing a cited answer');
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stream.aborted()).toBe(true);
    expect(await screen.findByText(/Stopped/)).toBeTruthy();
  });

  it('shows an error event with the request id', async () => {
    const stream = streamingFetch();
    renderPage(stream.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Ask for an answer' }));
    stream.push('event: error\ndata: {"code":"model_failed","message":"The model run failed."}\n\n');
    stream.finish();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('The model run failed.'));
    expect(screen.getByRole('alert').textContent).toContain('req-9');
  });

  describe('search options and the start', () => {
    afterEach(() => localStorage.clear());

    it('searches by the mode chosen under Search options and keeps it in the address', async () => {
      const { api, calls } = fakeApi({ 'POST search': () => hits });
      render(<SearchPage initial={{ ...emptySearch, q: 'stock' }} documents={[]} tags={[]} api={api} debounceMs={0} />);
      await userEvent.click(screen.getByText('Search options'));
      await userEvent.click(screen.getByRole('radio', { name: /Exact words/ }));
      await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ query: 'stock', mode: 'lexical' }));
      expect(location.search).toContain('mode=lexical');
      expect(screen.getByText('Search options').textContent).toContain('Exact words');
    });

    it('offers recent searches and suggested concepts before the first query', () => {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([{ label: 'feedback loops', href: '/search?q=feedback+loops' }]));
      const { api, calls } = fakeApi({});
      const suggestions = [{ label: 'STAR method', href: '/search?q=STAR+method' }];
      render(<SearchPage initial={emptySearch} documents={[]} tags={[]} suggestions={suggestions} api={api} debounceMs={0} />);
      const recent = screen.getByRole('region', { name: 'Recent searches' });
      expect(within(recent).getByRole('link', { name: 'feedback loops' }).getAttribute('href')).toBe('/search?q=feedback+loops');
      const concepts = screen.getByRole('region', { name: 'Concepts to look up' });
      expect(within(concepts).getByRole('link', { name: 'STAR method' }).getAttribute('href')).toBe('/search?q=STAR+method');
      expect(calls).toHaveLength(0);
    });
  });
});
