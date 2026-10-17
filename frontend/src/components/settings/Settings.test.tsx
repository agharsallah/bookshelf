import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Settings } from './Settings';

const headings = () => screen.getAllByRole('heading').map((h) => h.textContent);

describe('<Settings demo>', () => {
  it('shows only what is kept in this browser', () => {
    render(<Settings demo />);

    expect(headings()).toEqual(expect.arrayContaining(['Look', 'Reading', 'Encouragement']));
    for (const hidden of ['Listening', 'Database', 'Snapshot', 'Builds']) expect(headings()).not.toContain(hidden);
    expect(screen.queryByText(/Show the review queue/)).toBeNull();
  });
});
