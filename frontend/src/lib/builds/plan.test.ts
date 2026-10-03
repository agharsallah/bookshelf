import { describe, expect, it } from 'vitest';
import type { PreflightCheck } from '../api/types/builds';
import { blankMilestone, blocks, failingChecks, fixParts, milestonesProblem, move, removeAt, replaceAt } from './plan';

const check = (over: Partial<PreflightCheck>): PreflightCheck => ({ key: 'k', ok: false, level: 'error', message: 'm', fix: null, ...over });

describe('list edits', () => {
  it('moves an item one place and ignores moves off either end', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(move(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('replaces and removes by index', () => {
    expect(replaceAt(['a', 'b'], 1, 'x')).toEqual(['a', 'x']);
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
});

describe('milestonesProblem', () => {
  const m = (title: string) => ({ ...blankMilestone(), title, commit: `feat: ${title}`, deliverable: 'it', done_when: 'it runs' });

  it('wants 3 to 12 milestones, each with every field filled', () => {
    expect(milestonesProblem([m('a'), m('b')])).toMatch(/3 to 12/);
    expect(milestonesProblem([m('a'), m('b'), m('c')])).toBeNull();
    expect(milestonesProblem([m('a'), m('b'), { ...m('c'), commit: ' ' }])).toMatch(/^Milestone 3 needs every field/);
    expect(milestonesProblem([m('a'), { ...m('b'), done_when: '' }, m('c')])).toMatch(/^Milestone 2/);
  });
});

describe('preflight fixes', () => {
  it('takes code spans as commands', () => {
    expect(fixParts('Sign in with `gh auth login`, then re-check.')).toEqual({ text: 'Sign in with gh auth login, then re-check.', commands: ['gh auth login'] });
  });

  it('takes a bare command as one, and prose as prose', () => {
    expect(fixParts('gh auth login')).toEqual({ text: '', commands: ['gh auth login'] });
    expect(fixParts('Approve the paper card first.')).toEqual({ text: 'Approve the paper card first.', commands: [] });
    expect(fixParts(null)).toEqual({ text: '', commands: [] });
  });

  it('lists failing checks errors first, and blocks only on a failing error', () => {
    const checks = [check({ key: 'w', level: 'warning' }), check({ key: 'ok', ok: true }), check({ key: 'e' })];
    expect(failingChecks(checks).map((c) => c.key)).toEqual(['e', 'w']);
    expect(blocks(checks)).toBe(true);
    expect(blocks([check({ level: 'warning' })])).toBe(false);
  });
});
