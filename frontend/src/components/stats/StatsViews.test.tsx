import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChapterStats, Insight } from '../../lib/api/types/stats';
import { ChapterTable } from './ChapterTable';
import { InsightList } from './InsightList';

const jobs = { total: 3, done: 2, failed: 1, skipped: 0, queued: 0, running: 0 };

function chapter(anchor: string, overrides: Partial<ChapterStats> = {}): ChapterStats {
  return {
    anchor, title: `Title ${anchor}`, ordinal: 0, page_from: 1, page_to: 10, pages: 10, words: 3000, sections: 4,
    elements: 2, jobs, calls: 3, tokens: 12_345, compute_ms: 180_000, ms_by_kind: { summarize: 60_000, distil_section: 120_000 },
    tokens_per_1k_words: 4115, seconds_per_page: 18, grounding: 0.96, needs_review: 1, compression: 0.2, words_out: 800, ...overrides,
  };
}

describe('<ChapterTable>', () => {
  it('reads each chapter row in text, including the time split the bar draws', () => {
    render(<ChapterTable chapters={[chapter('ch01'), chapter('ch02', { jobs: { ...jobs, failed: 0 } })]} />);

    const [, first] = screen.getAllByRole('row');
    const row = within(first as HTMLElement);
    expect(row.getByRole('rowheader').textContent).toContain('Title ch01');
    expect(row.getByText('12.3k')).toBeTruthy();
    expect(row.getByText('1 failed')).toBeTruthy();
    expect(row.getByText('Summary 1 min, Section notes 2 min')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Time groups' }).children).toHaveLength(5);
  });

  it('says so when there are no chapters', () => {
    render(<ChapterTable chapters={[]} />);
    expect(screen.getByText('This book has no chapters yet.')).toBeTruthy();
  });
});

describe('<InsightList>', () => {
  const insight: Insight = {
    severity: 'high', area: 'reliability', subject: 'distil-section', title: 'distil-section fails 35% of its jobs',
    detail: 'Most common: timeout.', metric: 'failure_rate', value: 0.346, threshold: 0.1,
  };

  it('names severity in words, not colour alone, with the metric behind it', () => {
    render(<InsightList insights={[insight]} />);

    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('Fix first');
    expect(item.textContent).toContain('Reliability');
    expect(item.textContent).toContain('failure_rate = 0.346 (threshold 0.1)');
  });

  it('keeps problems in view and folds the notes under a disclosure', () => {
    const note: Insight = { ...insight, severity: 'info', area: 'cost', title: 'write-brief may hold up one tier cheaper' };
    render(<InsightList insights={[insight, note]} />);

    const details = screen.getByText(/1 note:/).closest('details');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('write-brief may hold up one tier cheaper');
    expect(screen.getAllByRole('list')[0]?.textContent).toContain('Fix first');
  });

  it('says nothing stands out when no rule fired', () => {
    render(<InsightList insights={[]} />);
    expect(screen.getByText(/Nothing stands out/)).toBeTruthy();
  });
});
