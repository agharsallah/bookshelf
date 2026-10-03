import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Totals } from '../../lib/api/types/readerStats';
import { BadgeCard } from './BadgeCard';
import { BadgeGrid } from './BadgeGrid';
import { Cheer } from './Cheer';
import { badgeStatuses, SEEN_STORAGE_KEY } from './badges';
import { StreakNote } from './StreakNote';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const totals = (over: Partial<Totals>) => ({ seconds: 0, active_days: 0, longest_streak: 0, books_finished: 0, chapters_finished: 0, words_read: 0, notes: 0, highlights: 0, recalls: 0, predictions: 0, reviews: 0, retention: null, longest_session_seconds: null, ...over }) as Totals;

describe('StreakNote', () => {
  it('carries the streak in both voices and adds the goal kept in this browser', async () => {
    localStorage.setItem('bookshelf:goal', '20');
    const { container } = render(<StreakNote streak={4} longest={9} activeToday todaySeconds={5 * 60} />);
    expect(container.querySelector('[data-cheer-only="quiet"]')?.textContent).toBe('4 days in a row. Your best is 9 days.');
    expect(container.querySelector('[data-cheer-only="playful"]')?.textContent).toMatch(/^🔥/);
    expect(await screen.findByText('5 of 20 minutes today, 15 to go.')).toBeTruthy();
  });

  it('renders nothing with no streak and no goal', () => {
    const { container } = render(<StreakNote streak={0} longest={0} activeToday={false} todaySeconds={0} />);
    expect(container.textContent).toBe('');
  });
});

describe('BadgeGrid', () => {
  it('marks levels earned since the last visit as new, then remembers them', async () => {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify({ chapters: 1 }));
    render(<BadgeGrid source={{ totals: totals({ chapters_finished: 12 }), hours: [], depth: [] }} />);
    expect(await screen.findByText('New')).toBeTruthy();
    expect(screen.getByText('Chapter by chapter').closest('li')?.hasAttribute('data-fresh')).toBe(true);
    expect(JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) ?? '{}')).toMatchObject({ chapters: 2 });
  });

  it('marks nothing new on a first visit', async () => {
    render(<BadgeGrid source={{ totals: totals({ chapters_finished: 12 }), hours: [], depth: [] }} />);
    expect(await screen.findByText(/levels earned/)).toBeTruthy();
    expect(screen.queryByText('New')).toBeNull();
  });
});

describe('a pinned tone', () => {
  it('renders one voice only, whatever the setting', () => {
    const { container } = render(<Cheer line={{ quiet: 'Past halfway.', playful: '🎉 Past the halfway mark!' }} tone="playful" />);
    expect(container.textContent).toBe('🎉 Past the halfway mark!');
    expect(container.querySelector('[data-cheer-only]')).toBeNull();
  });

  it('gives a badge one mark and one name', () => {
    const [streak] = badgeStatuses({ totals: totals({ longest_streak: 8 }), hours: [], depth: [] });
    if (!streak) throw new Error('no badge');
    const { container } = render(<ul><BadgeCard status={streak} tone="quiet" /></ul>);
    expect(container.querySelector('[data-cheer-only]')).toBeNull();
    expect(container.textContent).toContain('IISteady hand');
    expect(container.textContent).not.toContain('🔥');
  });
});
