import { describe, expect, it } from 'vitest';
import { BUILD_STATES, type BuildStops } from '../api/types/builds';
import { canContinue, canDelete, commitUrl, isActive, limitMeters, phaseOf, repoLabel, shortSha, stopsLine } from './state';

const stops = (over: Partial<BuildStops> = {}): BuildStops => ({ max_minutes: 90, max_commits: 30, max_budget_usd: null, done_when: [], ...over });

describe('build state', () => {
  it('polls only while the server is still working', () => {
    expect(BUILD_STATES.filter(isActive)).toEqual(['planning', 'building', 'stopping']);
  });

  it('shows the plan being made, the plan to review, then the run', () => {
    expect(phaseOf('planning')).toBe('plan');
    expect(phaseOf('planned')).toBe('review');
    expect(['building', 'stopping', 'done', 'stopped', 'failed'].map((s) => phaseOf(s as never))).toEqual(['run', 'run', 'run', 'run', 'run']);
  });

  it('continues only a finished or stopped run, and never deletes a running one', () => {
    expect(BUILD_STATES.filter(canContinue)).toEqual(['done', 'stopped']);
    expect(BUILD_STATES.filter((s) => !canDelete(s))).toEqual(['building', 'stopping']);
  });
});

describe('limitMeters', () => {
  it('measures time and commits against their limits, without a budget when uncapped', () => {
    const meters = limitMeters({ elapsed_seconds: 45 * 60 + 59, commits: [{ sha: 'a', subject: 's', at: '' }], cost_usd: 1.2, stops: stops() });
    expect(meters.map((m) => [m.key, m.value, m.max, m.fraction, m.text])).toEqual([
      ['time', 45, 90, 0.5, '45 of 90 min'],
      ['commits', 1, 30, 1 / 30, '1 of 30'],
    ]);
  });

  it('adds the budget when there is a cap, and never passes full', () => {
    const meters = limitMeters({ elapsed_seconds: null, commits: [], cost_usd: 12, stops: stops({ max_budget_usd: 5 }) });
    expect(meters[0]?.value).toBe(0);
    expect(meters[2]).toMatchObject({ key: 'budget', fraction: 1, text: '$12.00 of $5.00' });
  });
});

describe('links and labels', () => {
  it('links a commit on GitHub, and none for a local build', () => {
    expect(commitUrl('https://github.com/me/attn/', 'abc123')).toBe('https://github.com/me/attn/commit/abc123');
    expect(commitUrl(null, 'abc123')).toBeNull();
  });

  it('names a repo by owner and name', () => {
    expect(repoLabel('https://github.com/me/attn')).toBe('me/attn');
    expect(repoLabel('https://example.com/x')).toBe('https://example.com/x');
    expect(shortSha('0123456789abcdef')).toBe('0123456');
  });

  it('says the limits in one line', () => {
    expect(stopsLine(stops())).toBe('90 min · 30 commits · no budget cap');
    expect(stopsLine(stops({ max_budget_usd: 2.5 }))).toBe('90 min · 30 commits · $2.50 budget');
  });
});
