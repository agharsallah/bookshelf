import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BuildCreate, BuildTarget, TargetInspection } from '../../lib/api/types/builds';
import type { Call } from '../review/testing/fakeApi';
import { fakeApi } from '../review/testing/fakeApi';
import { buildDefaults, settingsOf } from '../settings/testing';
import { BuildForm } from './BuildForm';
import { build, check, contextPreview, inspection, preflightOf, repoChoice } from './testing';

const FOLDER = 'papers/attention-is-all-you-need';
const repos = [repoChoice(), repoChoice({ full_name: 'org/upstream', visibility: 'PUBLIC', can_push: false, description: null })];

function setup(inspect: (target: BuildTarget) => TargetInspection = () => inspection()) {
  const fake = fakeApi({
    'GET settings': () => settingsOf({ builds: buildDefaults({ owner: 'lab' }) }),
    'GET builds/presets': () => [],
    'GET builds/preflight': () => preflightOf(check()),
    'GET papers/attention/builds/context': () => contextPreview(),
    'GET builds/repos': (call: Call) => repos.filter((r) => r.full_name.includes((call.query as { q: string }).q)),
    'POST builds/target/inspect': (call: Call) => inspect(call.body as BuildTarget),
    'POST papers/attention/builds': () => build({ state: 'planning', plan: null }),
  });
  const onCreated = vi.fn();
  render(<BuildForm paperRef="attention" paperTitle="Attention Is All You Need" api={fake.api} onCreated={onCreated} inspectDelayMs={0} searchDelayMs={0} />);
  return { ...fake, onCreated };
}

const submit = () => screen.getByRole('button', { name: 'Draft the plan' });
const inspections = (calls: Call[]) => calls.filter((c) => c.path === 'builds/target/inspect').map((c) => c.body as BuildTarget);
const sent = (calls: Call[]) => calls.find((c) => c.path === 'papers/attention/builds')?.body as BuildCreate;

async function pickRepo(name = 'me/lab') {
  await userEvent.click(await screen.findByRole('radio', { name: /A GitHub repository/ }));
  await userEvent.type(screen.getByRole('combobox', { name: 'Repository' }), 'lab');
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('<BuildForm> into an existing repository', () => {
  it('shows the options each kind of target uses', async () => {
    setup();
    const group = (name: string) => screen.queryByRole('group', { name, hidden: true });
    await screen.findByLabelText('Name');
    expect(group('Visibility')).toBeTruthy();
    expect(group('License')).toBeTruthy();
    expect(group('Delivery')).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: /A GitHub repository/ }));
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(group('Visibility')).toBeNull();
    expect(group('License')).toBeNull();
    expect(group('Delivery')).toBeNull();
    expect(screen.queryByLabelText('Topics')).toBeNull();
    expect(group('Push')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Repository' })).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: /on this machine/ }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByLabelText('Path')).toBeTruthy();
    expect(group('Push')).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: /New repository/ }));
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(group('Visibility')).toBeTruthy();
  });

  it('searches your repositories, keeps read-only ones unpickable, and fills the branches from the inspection', async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole('radio', { name: /A GitHub repository/ }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Repository' }), '/');

    const readOnly = await screen.findByRole('option', { name: /org\/upstream/ });
    expect(readOnly.getAttribute('aria-disabled')).toBe('true');
    expect(within(readOnly).getByText('read-only')).toBeTruthy();
    expect(within(readOnly).getByText('public')).toBeTruthy();
    await userEvent.click(readOnly);
    expect(inspections(calls)).toEqual([]);
    expect(submit()).toHaveProperty('disabled', true);
    expect(screen.getByText('Pick a repository first.')).toBeTruthy();

    await userEvent.click(screen.getByRole('option', { name: /me\/lab/ }));
    const base = await screen.findByLabelText('Base branch');
    await waitFor(() => expect([...base.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['main (default)', 'develop']));
    expect(base).toHaveProperty('value', 'main');
    expect(inspections(calls)[0]).toEqual({
      kind: 'github',
      repo: 'me/lab',
      path: null,
      base_branch: null,
      folder: FOLDER,
      branch: null,
      use_repo_instructions: true,
      confine: 'warn',
      push_branch: false,
    });
    expect(screen.getByText(`${FOLDER} is free: the build creates it.`)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Detected stack' }).textContent).toContain('pyproject.toml');

    await userEvent.selectOptions(base, 'develop');
    await waitFor(() => expect(inspections(calls).at(-1)?.base_branch).toBe('develop'));
  });

  it('sends the target with the build, a pull request into the base by default', async () => {
    const { calls, onCreated } = setup();
    await userEvent.type(await screen.findByLabelText('Goal'), 'an interactive website explaining attention');
    await pickRepo();
    await screen.findByText(/is free/);
    await userEvent.type(screen.getByLabelText('Branch'), 'feat/attention');
    await userEvent.click(screen.getByRole('button', { name: 'Stop the run' }));
    await waitFor(() => expect(submit()).toHaveProperty('disabled', false));
    await userEvent.click(submit());

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const { options } = sent(calls);
    expect(options).toMatchObject({ repo_name: null, owner: null, visibility: 'private' });
    expect(options.advanced).toMatchObject({ delivery: 'pull_request', license: 'none', topics: [] });
    expect(options.target).toEqual({
      kind: 'github',
      repo: 'me/lab',
      path: null,
      base_branch: null,
      folder: FOLDER,
      branch: 'feat/attention',
      use_repo_instructions: true,
      confine: 'stop',
      push_branch: false,
    });
  });

  it('warns before pushing straight to the base branch', async () => {
    setup();
    await pickRepo();
    await userEvent.click(await screen.findByRole('button', { name: 'Push to main' }));
    expect(screen.getByText(/Commits land straight on main/)).toBeTruthy();
  });

  it('checks a local path, then builds on a branch of it that stays local unless pushed', async () => {
    const { calls, onCreated } = setup();
    await userEvent.type(await screen.findByLabelText('Goal'), 'an interactive website explaining attention');
    await userEvent.click(screen.getByRole('radio', { name: /on this machine/ }));
    const path = screen.getByLabelText('Path');
    await userEvent.type(path, 'code/lab');
    expect(screen.getByText(/An absolute path/)).toBeTruthy();
    expect(submit()).toHaveProperty('disabled', true);

    await userEvent.clear(path);
    await userEvent.type(path, '/Users/me/code/lab');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    await screen.findByText(/is free/);
    expect(inspections(calls)[0]).toMatchObject({ kind: 'local', repo: null, path: '/Users/me/code/lab', folder: FOLDER });
    expect(screen.getByText('build/attention-is-all-you-need', { selector: 'code' })).toBeTruthy();
    await userEvent.click(screen.getByRole('switch', { name: 'Also push build/attention-is-all-you-need to origin' }));
    await waitFor(() => expect(submit()).toHaveProperty('disabled', false));
    await userEvent.click(submit());

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const { options } = sent(calls);
    expect(options.visibility).toBe('local');
    expect(options.advanced.delivery).toBe('push_main');
    expect(options.target).toMatchObject({ kind: 'local', path: '/Users/me/code/lab', repo: null, push_branch: true });
  });

  it('holds the submit while the folder exists and is not empty, until another is chosen', async () => {
    const { calls } = setup((t) => inspection(t.folder === FOLDER ? { folder_exists: true, folder_empty: false, ok: false } : {}));
    await userEvent.type(await screen.findByLabelText('Goal'), 'an interactive website explaining attention');
    await pickRepo();

    const message = `${FOLDER} already exists and is not empty. Pick another folder: a build never writes over what is there.`;
    expect((await screen.findAllByText(message)).length).toBe(2);
    expect(submit()).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Folder').getAttribute('aria-invalid')).toBe('true');

    const folder = screen.getByLabelText('Folder');
    await userEvent.clear(folder);
    await userEvent.type(folder, 'papers/attention-v2');

    expect(await screen.findByText('papers/attention-v2 is free: the build creates it.')).toBeTruthy();
    await waitFor(() => expect(submit()).toHaveProperty('disabled', false));
    expect(screen.queryByText(message)).toBeNull();
    expect(inspections(calls).at(-1)?.folder).toBe('papers/attention-v2');
    expect(calls.some((c) => c.path === 'papers/attention/builds')).toBe(false);
  });

  it('shows the inspection: its problems with their fix, the instruction files, and the tree with the folder where it goes', async () => {
    const perm = { key: 'gh_perm', ok: false, level: 'error' as const, message: 'You cannot push to me/lab', fix: 'Ask for access, then `gh auth refresh`.' };
    setup(() => inspection({ ok: false, problems: [perm] }));
    await pickRepo();

    expect(await screen.findByText(/You cannot push to me\/lab/)).toBeTruthy();
    expect(screen.getByText('gh auth refresh', { selector: 'code' })).toBeTruthy();
    expect(submit()).toHaveProperty('disabled', true);
    expect(screen.getByText('Fix what the repository check found first.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Preview CLAUDE.md' }));
    expect(screen.getByText('Use uv. Keep files small.')).toBeTruthy();

    const tree = screen.getByRole('list', { name: 'Repository tree' });
    expect(within(tree).getByText('your folder · new')).toBeTruthy();
    expect(within(tree).getByText('bert/')).toBeTruthy();
    expect(within(tree).queryByText('app.py')).toBeNull();
    await userEvent.click(within(tree).getByRole('button', { name: 'Open src' }));
    expect(within(tree).getByText('app.py')).toBeTruthy();
  });
});
