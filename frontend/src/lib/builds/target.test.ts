import { describe, expect, it } from 'vitest';
import { ADVANCED_DEFAULTS } from '../api/types/builds';
import {
  advancedFor,
  defaultTarget,
  deliveryChoices,
  folderHint,
  folderState,
  repoFieldsFor,
  suggestBranch,
  suggestFolder,
  targetHold,
  targetOut,
  validateBranch,
  validateFolder,
  validateLocalPath,
  validateRepo,
  validateTarget,
  visibilityFor,
  type TargetDraft,
} from './target';
import { inspection } from '../../components/builds/testing';

const github = (over: Partial<TargetDraft> = {}): TargetDraft => ({ ...defaultTarget('attention'), kind: 'github', repo: 'me/lab', ...over });

describe('suggestions', () => {
  it('puts the build in papers/<paper slug>, on build/<folder slug>', () => {
    expect(suggestFolder('attention-is-all-you-need')).toBe('papers/attention-is-all-you-need');
    expect(defaultTarget('attention')).toMatchObject({ kind: 'new', folder: 'papers/attention', branch: '', delivery: 'pull_request', confine: 'warn', useRepoInstructions: true });
    expect(suggestBranch('papers/Attention Is/')).toBe('build/attention-is');
    expect(suggestBranch('')).toBe('build/paper');
  });
});

describe('validation', () => {
  it.each([
    ['', 'Name the folder'],
    ['/abs/path', 'no leading /'],
    ['papers/../etc', 'no ..'],
    ['..', 'no ..'],
    ['a//b', 'needs a name'],
    ['./a', 'needs a name'],
    ['a\\b', 'Use /'],
    ['.git/hooks', '.git'],
  ])('refuses the folder %j', (folder, message) => {
    expect(validateFolder(folder)).toContain(message);
  });

  it('takes a relative folder, a trailing slash included', () => {
    expect(validateFolder('papers/attention/')).toBeNull();
    expect(validateFolder('demo')).toBeNull();
  });

  it('wants owner/name for a GitHub repository and an absolute path for a local one', () => {
    expect(validateRepo('me/lab')).toBeNull();
    expect(validateRepo('lab')).toContain('owner/name');
    expect(validateRepo('')).toContain('Pick');
    expect(validateLocalPath('/Users/me/code/lab')).toBeNull();
    expect(validateLocalPath('code/lab')).toContain('absolute');
    expect(validateLocalPath('~/code/lab')).toContain('~');
  });

  it.each(['has space', 'a..b', 'a:b', 'a~1', 'x^', 'q?', 'st*r', 'br[', '/lead', 'trail/', 'a//b', '-dash', 'end.', 'x.lock', 'a/.hidden', '@', 'a@{b'])('refuses the branch %j', (name) => {
    expect(validateBranch(name)).toMatch(/^Not a branch name git takes/);
  });

  it('takes blank (the default) and ordinary branch names', () => {
    expect(validateBranch('')).toBeNull();
    expect(validateBranch('build/attention')).toBeNull();
    expect(validateBranch('feature/v1.2_x-y')).toBeNull();
  });

  it('checks only what the kind uses, and nothing for a new repository', () => {
    expect(validateTarget({ ...defaultTarget('x'), folder: '' })).toEqual({});
    expect(validateTarget(github({ repo: '', folder: '/x', branch: 'a b', baseBranch: 'm..n' }))).toEqual({
      targetRepo: 'Pick a repository.',
      targetFolder: 'A folder inside the repository: no leading /.',
      targetBranch: 'Not a branch name git takes: no spaces.',
      targetBase: 'Not a branch name git takes: no ...',
    });
    expect(validateTarget(github({ kind: 'local', repo: '', path: 'rel' }))).toEqual({ targetPath: 'An absolute path, from the root: /Users/you/code/project.' });
  });
});

describe('what applies per kind', () => {
  it('hides the new-repository options for an existing one; a local repo pushes only when asked', () => {
    expect(repoFieldsFor('new')).toEqual({ name: true, visibility: true, license: true, description: true, topics: true, delivery: true, push: true });
    expect(repoFieldsFor('github')).toEqual({ name: false, visibility: false, license: false, description: false, topics: false, delivery: false, push: true });
    expect(repoFieldsFor('local').push).toBe(false);
    expect(repoFieldsFor('local', true).push).toBe(true);
  });

  it('offers a pull request first, and pushing to the base with a warning', () => {
    const [pr, push] = deliveryChoices('develop');
    expect(pr).toMatchObject({ value: 'pull_request', warn: false });
    expect(pr?.hint).toContain('into develop');
    expect(push).toMatchObject({ value: 'push_main', label: 'Push to develop', warn: true });
  });

  it('sends GitHub checks for a GitHub repo and none for a local one', () => {
    expect(visibilityFor('github', 'local')).toBe('private');
    expect(visibilityFor('github', 'public')).toBe('public');
    expect(visibilityFor('local', 'private')).toBe('local');
    expect(visibilityFor('new', 'local')).toBe('local');
  });

  it("takes an existing repo's delivery from Where and drops what only a new repo has", () => {
    const advanced = { ...ADVANCED_DEFAULTS, license: 'MIT' as const, description: 'd', topics: ['t'], delivery: 'push_main' as const };
    expect(advancedFor({ kind: 'new', delivery: 'pull_request' }, advanced)).toBe(advanced);
    expect(advancedFor({ kind: 'github', delivery: 'pull_request' }, advanced)).toMatchObject({ license: 'none', description: null, topics: [], delivery: 'pull_request' });
    expect(advancedFor({ kind: 'local', delivery: 'pull_request' }, advanced).delivery).toBe('push_main');
  });
});

describe('targetOut', () => {
  it('leaves the target out for a new repository', () => {
    expect(targetOut(defaultTarget('x'))).toBeUndefined();
  });

  it('sends what the kind uses, blanks as null', () => {
    expect(targetOut(github({ path: '/ignored', folder: ' papers/attention/ ', pushBranch: true }))).toEqual({
      kind: 'github',
      repo: 'me/lab',
      path: null,
      base_branch: null,
      folder: 'papers/attention',
      branch: null,
      use_repo_instructions: true,
      confine: 'warn',
      push_branch: false,
    });
    expect(targetOut(github({ kind: 'local', path: '/code/lab', baseBranch: 'dev', branch: 'build/x', pushBranch: true, confine: 'stop' }))).toMatchObject({
      repo: null,
      path: '/code/lab',
      base_branch: 'dev',
      branch: 'build/x',
      push_branch: true,
      confine: 'stop',
    });
  });
});

describe('the inspection', () => {
  it('reads the folder as free, empty or taken', () => {
    expect(folderState({ folder_exists: false, folder_empty: false })).toBe('free');
    expect(folderState({ folder_exists: true, folder_empty: true })).toBe('empty');
    expect(folderState({ folder_exists: true, folder_empty: false })).toBe('taken');
    expect(folderHint('papers/x/', 'taken')).toMatch(/^papers\/x already exists and is not empty/);
  });

  it('holds the submit until an existing repo is inspected clean with a usable folder', () => {
    expect(targetHold('new', null, '')).toBeNull();
    expect(targetHold('github', null, 'f')).toBe('Pick a repository first.');
    expect(targetHold('local', null, 'f')).toBe('Check the repository first.');
    expect(targetHold('github', inspection({ folder_exists: true }), 'f')).toContain('not empty');
    expect(targetHold('github', inspection({ problems: [{ key: 'perm', ok: false, level: 'error', message: 'read-only', fix: null }] }), 'f')).toContain('Fix');
    expect(targetHold('github', inspection({ problems: [{ key: 'w', ok: false, level: 'warning', message: 'meh', fix: null }] }), 'f')).toBeNull();
    expect(targetHold('local', inspection({ folder_exists: true, folder_empty: true }), 'f')).toBeNull();
  });
});
