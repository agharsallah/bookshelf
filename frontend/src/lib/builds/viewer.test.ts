import { describe, expect, it } from 'vitest';
import { contextView } from '../../components/builds/testing';
import { isExtraTool, shellJoin, viewerTabs } from './viewer';

describe('viewerTabs', () => {
  it('gives a tab per file, then the kickoff, brief, tools, command and the planner input when there is one', () => {
    expect(viewerTabs(contextView()).map((t) => t.label)).toEqual(['PAPER.md', 'REFERENCES.md', 'Kickoff', 'Agent brief', 'Allowed tools', 'Command']);
    expect(viewerTabs(contextView({ plan_input: { goal: 'x' } })).at(-1)?.label).toBe('Planner input');
  });

  it('writes the command one flag per line, quoting what a shell would split', () => {
    expect(shellJoin(['claude', '-p', '--allowedTools', 'Read', 'Bash(git add:*)'])).toBe("claude \\\n  -p \\\n  --allowedTools Read 'Bash(git add:*)'");
  });

  it('marks the tools that come from your extra commands', () => {
    expect(isExtraTool('Bash(make:*)', ['make'])).toBe(true);
    expect(isExtraTool('Bash(make test:*)', ['make'])).toBe(false);
  });
});
