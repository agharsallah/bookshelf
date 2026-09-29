import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ActivityDay } from '../../lib/api/types/stats';
import { ActivityChart } from './ActivityChart';
import { emptyDay } from './activity';

describe('<ActivityChart>', () => {
  const days: ActivityDay[] = [
    { ...emptyDay('2026-09-10'), jobs: 4, failed: 1, compute_ms: 120_000, tokens: 2000, books: 1 },
    { ...emptyDay('2026-09-28'), jobs: 30, compute_ms: 3_600_000, tokens: 90_000, cost_usd: 1.5, books: 3 },
  ];

  it('summarizes the range in the chosen measure, and switches measure and range', async () => {
    render(<ActivityChart days={days} today="2026-09-29" />);
    await userEvent.click(screen.getByRole('button', { name: '30 days' }));
    const total = () => screen.getByText('Total').nextSibling?.textContent;
    expect(total()).toBe('1 h 2 min');
    expect(screen.getByText('Active days').nextSibling?.textContent).toBe('2 of 30');

    await userEvent.click(screen.getByRole('button', { name: 'Tokens' }));
    expect(total()).toBe('92k');
    expect(screen.getByText('Busiest day').nextSibling?.textContent).toBe('90k on 28 Sept');

    await userEvent.click(screen.getByRole('button', { name: '14 days' }));
    expect(screen.getByText('Active days').nextSibling?.textContent).toBe('1 of 14');
  });

  it('lists the active days in a table, newest first', () => {
    render(<ActivityChart days={days} today="2026-09-29" />);
    const [, first, second] = screen.getAllByRole('row');
    expect(first?.textContent).toContain('28 Sept 2026');
    expect(second?.textContent).toContain('10 Sept 2026');
  });

  it('says so when nothing has run', () => {
    render(<ActivityChart days={[]} today="2026-09-29" />);
    expect(screen.getByText('Nothing has run yet.')).toBeTruthy();
  });
});
