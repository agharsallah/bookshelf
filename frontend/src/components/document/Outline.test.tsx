// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import type { ChapterStatus } from '../../lib/documents/artifacts';
import { Outline } from './Outline';

vi.mock('./useDeriveJobs', () => ({ useDeriveJobs: () => ({ jobFor: () => undefined, queue: null, now: 0, track: () => undefined }) }));
afterEach(cleanup);

const node = (anchor: string, heading: string, children: TreeNode[] = []): TreeNode =>
  ({ anchor, kind: children.length ? 'chapter' : 'section', heading, depth: 0, page_from: null, page_to: null, meta: {}, children }) as unknown as TreeNode;

const position = (unit: string, anchor: string, progress: number): ReadingPosition => ({
  unit,
  anchor,
  progress,
  updated_at: '2026-09-26T12:00:00Z',
});

const units = [node('ch01', 'Stocks', [node('ch01/s01', 'Inflows')]), node('ch02', 'Flows'), node('ch03', 'Delays')];

function renderOutline({ positions = {}, statuses = {}, actionable = false }: { positions?: Record<string, ReadingPosition>; statuses?: Record<string, ChapterStatus>; actionable?: boolean } = {}) {
  render(<Outline documentId="d1" slug="meadows" units={units} statuses={statuses} actionable={actionable} positions={positions} />);
  return screen.getAllByRole('listitem').filter((li) => li.querySelector('[aria-expanded]'));
}

describe('<Outline> reading progress', () => {
  it('opens each title where you left off: at the block last read, from the top when finished or unread', () => {
    const [stocks, flows, delays] = renderOutline({
      positions: { ch01: position('ch01', 'ch01/p040', 1), ch02: position('ch02', 'ch02/s01/p003', 0.42) },
    });

    expect(within(stocks!).getByRole('link', { name: /Stocks/ }).getAttribute('href')).toBe('/documents/meadows/read/ch01');
    expect(within(stocks!).getByRole('link', { name: /Stocks/ }).textContent).toContain('read again');
    expect(within(flows!).getByRole('link', { name: /Flows/ }).getAttribute('href')).toBe('/documents/meadows/read/ch02/s01/p003');
    expect(flows?.textContent).toContain('42%');
    expect(within(delays!).getByRole('link', { name: 'Delays' }).getAttribute('href')).toBe('/documents/meadows/read/ch03');
    expect(delays?.textContent).not.toContain('%');
  });
});

describe('<Outline> chapter details', () => {
  const approved: ChapterStatus = { summary: 'approved', distillation: 'approved', waiting: 0 };

  it('keeps every chapter to one line until its details are asked for', async () => {
    const [stocks] = renderOutline({ statuses: { ch01: approved }, actionable: true });
    const toggle = within(stocks!).getByRole('button', { name: 'Show details for Stocks' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Inflows' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull();

    await userEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByRole('region', { name: 'Details for Stocks' });
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id);
    expect(within(panel).getByRole('link', { name: 'Inflows' }).getAttribute('href')).toBe('/documents/meadows/read/ch01/s01');
    expect(within(panel).getByRole('button', { name: 'Distil chapter' })).toBeTruthy();
    expect(within(panel).getByText('Distillation').parentElement?.textContent).toContain('approved');

    await userEvent.click(toggle);
    expect(screen.queryByRole('region', { name: 'Details for Stocks' })).toBeNull();
  });

  it('opens and closes every chapter at once', async () => {
    renderOutline();
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('region')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('offers no re-runs while jobs cannot be queued', async () => {
    renderOutline({ actionable: false });
    await userEvent.click(screen.getByRole('button', { name: 'Show details for Stocks' }));
    expect(screen.queryByRole('button', { name: 'Summarize' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Distil section/ })).toBeNull();
  });

  it('flags drafts waiting for review on the row, linking to the queue', () => {
    const [, flows] = renderOutline({ statuses: { ch01: approved, ch02: { ...approved, waiting: 2 } } });
    expect(within(flows!).getByRole('link', { name: '2 to review' }).getAttribute('href')).toBe('/review');
    expect(screen.getByText('3 chapters · 2 distilled · 2 to review')).toBeTruthy();
  });
});
