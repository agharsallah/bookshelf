import { describe, expect, it } from 'vitest';
import type { BookRow, DocumentStats, LibraryStats } from '../../lib/api/types/stats';
import { bookTiles, libraryTiles } from './tiles';

const durations = { count: 0, total_ms: 0, mean_ms: null, p50_ms: null, p95_ms: null, max_ms: null };
const jobs = { total: 10, done: 8, failed: 2, skipped: 0, queued: 3, running: 1 };
const book = {
  id: 'b1', slug: 'meadows', title: 'Thinking in Systems', authors: ['Donella Meadows'], year: 2008, kind: 'pdf' as const,
  status: 'linked' as const, language: 'en', parse_tier: 1, pages: 200, chapters: 7, sections: 30, blocks: 900, words: 60_000,
  elements: {}, created_at: '2026-09-01T09:00:00Z',
};
const time = { wall_ms: 7_200_000, active_ms: 3_600_000, compute_ms: 5_400_000, model_ms: null, parallelism: 1.5, wait: durations };
const tokens = { tokens: 1_200_000, input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, cost_usd: null, wasted_tokens: null, tracked_calls: 0 };
const efficiency = { tokens_per_page: 6000, tokens_per_1k_words: 20_000, seconds_per_page: 27, minutes_per_10k_words: 15, cost_per_page_usd: null };

function stats(overrides: Partial<DocumentStats> = {}): DocumentStats {
  return {
    book, jobs, tokens, time, efficiency, passes: [], stages: [], chapters: [], skills: [], models: [], insights: [],
    end_to_end: { index: 0, started_at: '', finished_at: '', wall_ms: 6_044_359, active_ms: 1, compute_ms: 1, jobs: 212, tokens: 1, includes_parse: true, stages: [] },
    remaining: { queued: 3, running: 1, eta_ms: 64_000 }, telemetry_since: null, generated_at: '', ...overrides,
  };
}

const value = (tiles: { label: string; value: string; note?: string }[], label: string) => tiles.find((t) => t.label === label);

describe('bookTiles', () => {
  it('leads with the first pass, compute and tokens', () => {
    const tiles = bookTiles(stats());

    expect(tiles.slice(0, 3).map((t) => t.label)).toEqual(['End to end', 'Compute', 'Tokens']);
    expect(value(tiles, 'End to end')).toMatchObject({ value: '1 h 40 min', note: 'first pass · 212 jobs' });
    expect(value(tiles, 'Compute')?.note).toBe('busy 1 h · 1.5× parallel');
    expect(value(tiles, 'Left')).toMatchObject({ value: '4', note: 'about 1 min 4 s to go' });
  });

  it('says when cache and cost are not tracked yet, and when a book has no pages', () => {
    const tiles = bookTiles(stats({ book: { ...book, pages: null } }));

    expect(value(tiles, 'Tokens')?.note).toMatch(/cache tracked from the next runs/);
    expect(value(tiles, 'Cost reported')?.value).toBe('—');
    expect(value(tiles, 'Per page')?.note).toBe('no page numbers (EPUB)');
  });

  it('counts prompt-cache tokens once calls are tracked', () => {
    const tracked = { ...tokens, tracked_calls: 3, cache_read_tokens: 7900, cache_write_tokens: 8502, cost_usd: 0.0388 };

    expect(value(bookTiles(stats({ tokens: tracked })), 'Tokens')?.note).toBe('input + output · 16.4k more via prompt cache');
  });
});

describe('libraryTiles', () => {
  it('reports the median first pass across books', () => {
    const row = (ms: number | null): BookRow => ({ book, jobs, tokens, time, efficiency, end_to_end_ms: ms, failure_rate: 0.2, remaining: { queued: 0, running: 0, eta_ms: null }, last_activity: null });
    const library: LibraryStats = { books: [row(1000), row(60_000), row(null), row(3_600_000)], jobs, tokens, time, skills: [], models: [], insights: [], telemetry_since: null, generated_at: '' };

    expect(value(libraryTiles(library), 'Typical end to end')?.value).toBe('1 min');
    expect(value(libraryTiles(library), 'Jobs')?.note).toBe('20% failed');
  });
});
