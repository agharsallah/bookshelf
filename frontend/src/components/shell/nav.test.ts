import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import { NAV, isCurrent, loadNavCounts, navPath, pipelineSignal } from './nav';

const item = (href: string) => NAV.find((i) => i.href === href)!;

describe('isCurrent', () => {
  it('marks Today only on the home page, not on every page by prefix', () => {
    expect(isCurrent(item('/'), '/')).toBe(true);
    expect(isCurrent(item('/'), '/library')).toBe(false);
  });

  it('marks an item on its own pages and the pages it owns', () => {
    expect(isCurrent(item('/library'), '/documents/meadows/read/ch01')).toBe(true);
    expect(isCurrent(item('/graph'), '/concepts/0c00')).toBe(true);
    expect(isCurrent(item('/graph'), '/graph/concept/0c00')).toBe(true);
    expect(isCurrent(item('/search'), '/searchlight')).toBe(false);
  });
});

describe('navPath', () => {
  const at = (href: string) => new URL(href, 'http://localhost');

  it('puts a document reached from a collection under Collections, not the Library', () => {
    const path = navPath(at('/documents/lora/read/ch01?collection=gemma-agent'));
    expect(path).toBe('/collections/gemma-agent');
    expect(isCurrent(item('/collections'), path)).toBe(true);
    expect(isCurrent(item('/library'), path)).toBe(false);
  });

  it('leaves every other page, and a malformed collection, as it is', () => {
    expect(navPath(at('/documents/lora?collection=Not A Slug'))).toBe('/documents/lora');
    expect(navPath(at('/documents/lora'))).toBe('/documents/lora');
    expect(navPath(at('/library?collection=gemma-agent'))).toBe('/library');
  });
});

describe('the navigation', () => {
  it('counts the stats pages as part of the pipeline', () => {
    expect(isCurrent(item('/pipeline'), '/pipeline/stats')).toBe(true);
    expect(isCurrent(item('/pipeline'), '/pipeline/stats/meadows-systems')).toBe(true);
  });

  it('lists the paper shelf right after the library, reading-side', () => {
    const reading = NAV.filter((i) => !i.workshop).map((i) => i.label);
    expect(reading.slice(1, 3)).toEqual(['Library', 'Papers']);
    expect(isCurrent(item('/papers'), '/papers')).toBe(true);
    expect(isCurrent(item('/papers'), '/papers/next')).toBe(true);
    expect(isCurrent(item('/papers'), '/paperstack')).toBe(false);
  });

  it('marks Papers, not the Library, on a paper’s own pages', () => {
    expect(isCurrent(item('/papers'), '/documents/bert/paper/card')).toBe(true);
    expect(isCurrent(item('/library'), '/documents/bert/paper/card')).toBe(false);
    expect(isCurrent(item('/library'), '/documents/bert')).toBe(true);
    expect(isCurrent(item('/papers'), '/documents/paperclip/read/ch01')).toBe(false);
  });

  it('offers the pills feed reading-side, marked on its page whatever its presets', () => {
    expect(NAV.filter((i) => !i.workshop).map((i) => i.label)).toContain('Pills');
    expect(isCurrent(item('/pills'), '/pills')).toBe(true);
    expect(isCurrent(item('/pills'), '/pillsbury')).toBe(false);
  });

  it('counts every book’s reader statistics as part of You', () => {
    expect(isCurrent(item('/you'), '/you/meadows-systems')).toBe(true);
  });

  it('keeps review and the pipeline in the workshop, each with its count', () => {
    expect(NAV.filter((i) => i.workshop).map((i) => [i.label, i.count])).toEqual([
      ['Review', 'review'],
      ['Pipeline', 'pipeline'],
    ]);
  });
});

describe('loadNavCounts', () => {
  it('counts the review queue and the jobs queued, running and failed', async () => {
    const totals: Record<string, number> = { queued: 2, running: 1, failed: 5 };
    const get = vi.fn(async (path: string, options?: { query?: Record<string, unknown> }) => {
      if (path === 'jobs') return { items: [], total: totals[String(options?.query?.state)] ?? 0, limit: 1, offset: 0 };
      const review = options?.query?.review;
      return { items: [{}], total: review === 'draft' ? 1281 : 236, limit: 1, offset: 0 };
    });
    expect(await loadNavCounts({ get } as unknown as ApiClient)).toEqual({ review: 1517, active: 3, failed: 5 });
  });

  it('asks the queue for its totals only: one row per state, without bodies', async () => {
    const get = vi.fn(async (_path: string, _options?: { query?: Record<string, unknown> }) => ({ items: [], total: 0, limit: 1, offset: 0 }));
    await loadNavCounts({ get } as unknown as ApiClient);
    const queue = get.mock.calls.filter(([path]) => path === 'artifacts').map(([, options]) => options);
    expect(queue).toEqual([
      { query: { review: 'needs_review', latest: true, body: false, limit: 1 } },
      { query: { review: 'draft', latest: true, body: false, limit: 1 } },
    ]);
  });
});

describe('pipelineSignal', () => {
  it('shows work in progress before failures, and nothing when all is quiet', () => {
    expect(pipelineSignal({ active: 2, failed: 9 })).toEqual({ state: 'busy', label: '2 jobs in progress' });
    expect(pipelineSignal({ active: 0, failed: 1 })).toEqual({ state: 'failed', label: '1 failed job' });
    expect(pipelineSignal({ active: 0, failed: 0 }).state).toBe('idle');
  });
});
