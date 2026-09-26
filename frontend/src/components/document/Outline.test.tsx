// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import { Outline } from './Outline';

vi.mock('./useDeriveJobs', () => ({ useDeriveJobs: () => ({ jobFor: () => undefined, queue: null, now: 0, track: () => undefined }) }));
afterEach(cleanup);

const chapter = (anchor: string, heading: string): TreeNode =>
  ({ anchor, kind: 'chapter', heading, depth: 0, page_from: null, page_to: null, meta: {}, children: [] }) as unknown as TreeNode;

const position = (unit: string, anchor: string, progress: number): ReadingPosition => ({
  unit,
  anchor,
  progress,
  updated_at: '2026-09-26T12:00:00Z',
});

const units = [chapter('ch01', 'Stocks'), chapter('ch02', 'Flows'), chapter('ch03', 'Delays')];

function renderOutline(positions: Record<string, ReadingPosition>) {
  render(<Outline documentId="d1" slug="meadows" units={units} statuses={{}} actionable={false} positions={positions} />);
  return screen.getAllByRole('listitem').filter((li) => li.parentElement?.tagName === 'OL' && li.querySelector('summary'));
}

describe('<Outline> reading progress', () => {
  it('continues a chapter at the block last read, re-reads a finished one, and starts an unread one', () => {
    const [stocks, flows, delays] = renderOutline({
      ch01: position('ch01', 'ch01/p040', 1),
      ch02: position('ch02', 'ch02/s01/p003', 0.42),
    });

    expect(stocks?.querySelector('a')?.getAttribute('href')).toBe('/documents/meadows/read/ch01');
    expect(stocks?.textContent).toContain('Read again');
    expect(flows?.querySelector('a')?.getAttribute('href')).toBe('/documents/meadows/read/ch02/s01/p003');
    expect(flows?.textContent).toContain('Continue reading');
    expect(flows?.querySelector('summary')?.textContent).toContain('42%');
    expect(delays?.querySelector('a')?.textContent).toBe('Read');
    expect(delays?.querySelector('summary')?.textContent).not.toContain('%');
  });
});
