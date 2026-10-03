import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { BuildAdvanced, BuildVisibility } from '../../lib/api/types/builds';
import { advancedBaseline, validateAdvanced } from '../../lib/builds/advanced';
import { AdvancedPanel } from './AdvancedPanel';

const baseline = advancedBaseline({ model: 'sonnet' });
let latest: { advanced: BuildAdvanced; allowWeb: boolean } = { advanced: baseline, allowWeb: false };

/** Holds the values the way the form does, and keeps the last for assertions. */
function Harness({ visibility = 'private' }: { visibility?: BuildVisibility }) {
  const [state, setState] = useState({ advanced: baseline, allowWeb: false });
  latest = state;
  return (
    <AdvancedPanel
      advanced={state.advanced}
      allowWeb={state.allowWeb}
      visibility={visibility}
      baseline={baseline}
      presetToolchains={['python']}
      errors={validateAdvanced(state.advanced)}
      onChange={(patch) => setState({ ...state, ...patch })}
    />
  );
}

const open = () => userEvent.click(screen.getByText('Advanced'));

describe('<AdvancedPanel>', () => {
  it('counts what differs from your defaults in its summary, and resets it all', async () => {
    render(<Harness />);
    await open();
    expect(screen.queryByText(/changed/)).toBeNull();

    await userEvent.click(within(screen.getByRole('group', { name: 'Build model' })).getByRole('button', { name: 'Opus' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /search the web/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Node' }));

    expect(screen.getByText('3 changed')).toBeTruthy();
    expect(latest.advanced.toolchains).toEqual(['python', 'node']);

    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.queryByText(/changed/)).toBeNull();
    expect(latest).toEqual({ advanced: baseline, allowWeb: false });
  });

  it('takes an extra command only in a shape the sandbox accepts', async () => {
    render(<Harness />);
    await open();
    const input = screen.getByLabelText('Extra commands');

    await userEvent.type(input, 'rm -rf /{Enter}');
    expect(screen.getByText(/A command name/)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');

    await userEvent.clear(input);
    await userEvent.type(input, 'make{Enter}');
    expect(screen.queryByText(/A command name/)).toBeNull();
    expect(latest.advanced.extra_commands).toEqual(['make']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove make' }));
    expect(latest.advanced.extra_commands).toEqual([]);
  });

  it('holds the pull request back for a local build and says why', async () => {
    render(<Harness visibility="local" />);
    await open();
    expect(screen.getByRole('button', { name: 'Pull request' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Push to main' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/A pull request needs GitHub/)).toBeTruthy();
  });
});
