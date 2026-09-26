// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { artifact } from './fixtures';
import { GateBadges } from './GateBadges';

afterEach(cleanup);

describe('GateBadges', () => {
  it('states the score and the threshold it has to clear, in words and on the meter', () => {
    render(<GateBadges artifact={artifact({ gates: { grounding: 0.85 } })} />);
    const meter = screen.getByRole('meter', { name: 'Grounding' });
    expect(meter.getAttribute('aria-valuenow')).toBe('85');
    expect(meter.getAttribute('aria-valuetext')).toBe('Grounding 85%, threshold 90%');
    expect(screen.getByText(/grounded, needs 90%/)).toBeTruthy();
  });

  it('keeps the row variant to the number alone', () => {
    render(<GateBadges artifact={artifact({ gates: { grounding: 1 } })} compact />);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.queryByText(/needs/)).toBeNull();
  });
});
