import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import type { LibraryFile } from '../../lib/api/types/documents';
import type { Job } from '../../lib/api/types/jobs';
import { IngestPanel } from './IngestPanel';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  url: (path: string, query?: Record<string, string>) =>
    `/api/${path}${query ? `?${new URLSearchParams(query).toString()}` : ''}`,
}));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));

/** A controllable stand-in for the browser's EventSource (an unmanaged network edge). */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const l of this.listeners.get(type) ?? []) l(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  close() {}
}

const file: LibraryFile = {
  path: 'library/meadows.pdf',
  size: 2048,
  modified_at: '2026-09-01T00:00:00Z',
  kind: 'pdf',
  sha256: 'abc',
  suggested_title: 'Meadows',
  suggested_slug: 'meadows',
};

const job = (state: Job['state'], attempts = 0): Job => ({
  id: 'job-1',
  kind: 'parse',
  document_id: 'doc-1',
  anchor: null,
  skill: null,
  skill_version: null,
  state,
  attempts,
  error: null,
  result: null,
  run_mode: null,
  duration_ms: null,
  created_at: '2026-09-23T10:00:00Z',
  started_at: null,
  finished_at: null,
});

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  FakeEventSource.last = null;
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<IngestPanel>', () => {
  it('links to the existing document when the file is already on the shelf (409)', async () => {
    api.post.mockRejectedValue(
      new ApiError({
        status: 409,
        code: 'conflict',
        message: 'Already ingested.',
        details: [{ document_id: 'd9', slug: 'thinking-in-systems' }],
      }),
    );
    render(<IngestPanel initialFiles={[file]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Already on the shelf');
    expect(within(status).getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe(
      '/documents/thinking-in-systems',
    );
    expect(api.post).toHaveBeenCalledWith('documents', { path: 'library/meadows.pdf' });
  });

  it('follows the parse job live until the document is on the shelf', async () => {
    api.post.mockResolvedValue({ document: { slug: 'meadows', title: 'Meadows' }, job: job('queued'), deduplicated: false });
    render(<IngestPanel initialFiles={[file]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add to shelf' }));

    expect((await screen.findByRole('status')).textContent).toContain('Waiting for the worker');
    expect(FakeEventSource.last?.url).toBe('/api/jobs/stream');

    FakeEventSource.last?.emit('job', job('running', 1));
    expect((await screen.findByText(/Parsing/)).textContent).toContain('Parsing');

    FakeEventSource.last?.emit('job', job('done', 1));
    const link = await screen.findByRole('link', { name: 'Open' });
    expect(link.getAttribute('href')).toBe('/documents/meadows');
  });

  it('adds an article by URL', async () => {
    api.post.mockResolvedValue({ document: { slug: 'essay', title: 'Essay' }, job: job('queued'), deduplicated: false });
    render(<IngestPanel initialFiles={[]} />);
    await userEvent.type(screen.getByLabelText('Or add an article by URL'), 'https://example.com/essay');
    await userEvent.click(screen.getByRole('button', { name: 'Add article' }));
    expect(api.post).toHaveBeenCalledWith('documents', { url: 'https://example.com/essay' });
    expect(await screen.findByText('https://example.com/essay')).toBeTruthy();
  });

  it('says why when the library folder cannot be listed', async () => {
    api.get.mockRejectedValue(new ApiError({ status: 502, code: 'upstream_unavailable', message: 'The API could not be reached.', requestId: 'r1' }));
    render(<IngestPanel initialFiles={null} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The API could not be reached.');
    expect(alert.textContent).toContain('r1');
  });
});
