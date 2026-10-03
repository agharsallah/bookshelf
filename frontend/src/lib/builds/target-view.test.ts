import { describe, expect, it } from 'vitest';
import { ADVANCED_DEFAULTS } from '../api/types/builds';
import { localBranchNote, repoTree, shortPath, targetLabel, targetSummary } from './target-view';
import { target } from '../../components/builds/testing';

const opts = (t = target(), delivery: 'pull_request' | 'push_main' = 'pull_request') => ({ target: t, advanced: { ...ADVANCED_DEFAULTS, delivery } });
const local = target({ kind: 'local', repo: null, path: '/Users/me/code/foo' });

describe('target lines', () => {
  it('says nothing for a new repository', () => {
    expect(targetSummary({ advanced: ADVANCED_DEFAULTS })).toBeNull();
    expect(targetSummary(opts(target({ kind: 'new' })))).toBeNull();
    expect(targetLabel({})).toBeNull();
  });

  it('restates a GitHub target with its branch and delivery', () => {
    expect(targetSummary(opts())).toBe('Into me/lab · papers/attention on build/attention → pull request into the default branch');
    expect(targetSummary(opts(target({ base_branch: 'main', branch: 'feat/x' }), 'push_main'))).toBe('Into me/lab · papers/attention on feat/x → pushed straight to main');
    expect(targetLabel(opts())).toBe('me/lab · papers/attention');
  });

  it('restates a local target, home folder shortened', () => {
    expect(targetSummary(opts(local))).toBe('Into ~/code/foo (local) · papers/attention on build/attention · stays local');
    expect(targetSummary(opts({ ...local, push_branch: true }))).toContain('· pushed to origin');
    expect(targetLabel(opts(local))).toBe('~/code/foo · papers/attention');
    expect(shortPath('/home/me')).toBe('~');
    expect(shortPath('/srv/code')).toBe('/srv/code');
  });

  it('tells where a local build left its work once the run has ended', () => {
    expect(localBranchNote({ state: 'done', options: opts(local) })).toEqual({ branch: 'build/attention', path: '~/code/foo', command: 'git switch build/attention' });
    expect(localBranchNote({ state: 'building', options: opts(local) })).toBeNull();
    expect(localBranchNote({ state: 'planned', options: opts(local) })).toBeNull();
    expect(localBranchNote({ state: 'done', options: opts() })).toBeNull();
  });
});

describe('repoTree', () => {
  const tree = ['src/', 'src/app.py', 'README.md', 'papers/', 'papers/bert/', 'docs/guide.md', 'docs/img/logo.png'];

  it('folds the survey to top-level entries with their children, directories first', () => {
    const top = repoTree(tree, '');
    expect(top.map((n) => [n.name, n.dir])).toEqual([
      ['docs', true],
      ['papers', true],
      ['src', true],
      ['README.md', false],
    ]);
    expect(top[0]?.children.map((n) => [n.name, n.dir])).toEqual([
      ['img', true],
      ['guide.md', false],
    ]);
  });

  it('marks the folder where it goes, as a ghost when it does not exist yet', () => {
    const papers = repoTree(tree, 'papers/attention').find((n) => n.name === 'papers');
    expect(papers).toMatchObject({ mark: 'contains', ghost: false });
    expect(papers?.children.find((n) => n.name === 'attention')).toMatchObject({ mark: 'target', ghost: true, path: 'papers/attention' });

    const fresh = repoTree(tree, 'experiments/a/b').find((n) => n.name === 'experiments');
    expect(fresh).toMatchObject({ mark: 'contains', ghost: true, dir: true });
    expect(fresh?.children[0]).toMatchObject({ name: 'a', mark: 'contains' });

    expect(repoTree(tree, 'src').find((n) => n.name === 'src')).toMatchObject({ mark: 'target', ghost: false });
  });
});
