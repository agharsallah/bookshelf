import { describe, expect, it } from 'vitest';
import { plan, planVersion } from '../../components/builds/testing';
import type { BuildMilestone } from '../api/types/builds';
import { basedOnNote, changedLine, diffList, diffMilestones, diffPlans, versionLabel, versionShortLabel } from './plan-diff';

const m = (title: string, over: Partial<BuildMilestone> = {}): BuildMilestone => ({ title, commit: `feat: ${title}`, deliverable: `${title}.py`, done_when: `${title} works`, ...over });

/** Each entry as `kind title` (plus the changed fields), to read a diff at a glance. */
const read = (before: BuildMilestone[], after: BuildMilestone[]) =>
  diffMilestones(before, after).map((d) => {
    if (d.kind === 'added') return `added ${d.after.title}`;
    if (d.kind === 'removed') return `removed ${d.before.title}`;
    if (d.kind === 'changed') return `changed ${d.before.title}→${d.after.title} [${d.fields.join(',')}]`;
    return `same ${d.after.title}`;
  });

describe('version labels', () => {
  it('names a first draft, a replan and your edit', () => {
    expect(versionLabel(planVersion())).toBe('Drafted');
    expect(versionLabel(planVersion({ version: 2, based_on: 1 }))).toBe('Replanned');
    expect(versionLabel(planVersion({ version: 3, origin: 'human', based_on: 2 }))).toBe('Edited by you');
    expect(versionShortLabel(planVersion({ origin: 'human', based_on: 2 }))).toBe('Edited');
  });

  it('notes the version a revision started from', () => {
    expect(basedOnNote(planVersion())).toBe('');
    expect(basedOnNote(planVersion({ based_on: 2 }))).toBe('from v2');
  });
});

describe('diffMilestones', () => {
  it('matches by position when titles agree, and marks the fields that changed', () => {
    expect(read([m('A'), m('B')], [m('A'), m('B', { commit: 'fix: b', done_when: 'tests pass' })])).toEqual(['same A', 'changed B→B [commit,done_when]']);
  });

  it('follows a moved milestone by its title instead of calling it changed', () => {
    expect(read([m('A'), m('B'), m('C')], [m('C'), m('A'), m('B')])).toEqual(['same C', 'same A', 'same B']);
  });

  it('treats a new title at the same place as that milestone renamed', () => {
    expect(read([m('A'), m('B')], [m('A'), m('Bee', { commit: 'feat: B', deliverable: 'B.py', done_when: 'B works' })])).toEqual(['same A', 'changed B→Bee [title]']);
  });

  it('calls a milestone that kept nothing at the same place another milestone', () => {
    expect(read([m('A'), m('B')], [m('A'), m('C')])).toEqual(['same A', 'removed B', 'added C']);
  });

  it('marks added milestones, and removed ones where they used to be', () => {
    expect(read([m('A'), m('B'), m('C')], [m('A'), m('C'), m('D')])).toEqual(['same A', 'removed B', 'same C', 'added D']);
    expect(read([m('A'), m('B')], [m('B')])).toEqual(['removed A', 'same B']);
  });

  it('ignores whitespace and title case when matching', () => {
    expect(read([m('Train it')], [m(' train  it ', { commit: 'feat: Train it', deliverable: 'Train it.py', done_when: 'Train it works' })])).toEqual(['changed Train it→ train  it  [title]']);
  });
});

describe('diffList', () => {
  it('lists what was added and removed', () => {
    expect(diffList(['Python', 'PyTorch'], ['Python', 'JAX '])).toEqual({ added: ['JAX '], removed: ['PyTorch'] });
  });
});

describe('diffPlans', () => {
  it('finds no change between a plan and itself', () => {
    const d = diffPlans(plan(), plan());
    expect(d.changed).toBe(false);
    expect(d.milestones.every((x) => x.kind === 'same')).toBe(true);
  });

  it('reports the summary, the stack and the out-of-scope list', () => {
    const d = diffPlans(plan(), plan({ summary: 'Smaller.', stack: ['Python'], out_of_scope: ['Multi-GPU training', 'Tokenizers'] }));
    expect(d.changed).toBe(true);
    expect(d.summary).toEqual({ changed: true, before: plan().summary, after: 'Smaller.' });
    expect(d.stack).toEqual({ added: [], removed: ['PyTorch'] });
    expect(d.outOfScope).toEqual({ added: ['Tokenizers'], removed: [] });
  });

  it('says which fields changed in words', () => {
    expect(changedLine(['commit', 'done_when'])).toBe('Changed: commit, done when');
  });
});
