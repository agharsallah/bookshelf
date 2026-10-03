import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextViewer } from './ContextViewer';
import { contextView } from './testing';

describe('<ContextViewer>', () => {
  it('shows a tab per file and per input, its word count, and copies what it shows', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<ContextViewer view={contextView()} />);

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['PAPER.md', 'REFERENCES.md', 'Kickoff', 'Agent brief', 'Allowed tools', 'Command']);
    expect(screen.getByText('From the workspace')).toBeTruthy();
    expect(screen.getByText('5 words')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Kickoff' }));
    expect(screen.getByLabelText('Kickoff', { selector: 'pre' }).textContent).toBe('Build a tiny transformer.');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Build a tiny transformer.');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('lists the allowed tools, the ones you added marked', async () => {
    render(<ContextViewer view={contextView({ source: 'rendered' })} extraCommands={['make']} />);
    expect(screen.getByText('Rendered preview')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Allowed tools' }));
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['Read', 'Write', 'Bash(git commit:*)', 'Bash(make:*)you added']);
    expect(screen.getByText('4 tools')).toBeTruthy();
  });
});
