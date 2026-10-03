import { describe, expect, it } from 'vitest';
import { ADVANCED_DEFAULTS, type BuildPreset } from '../api/types/builds';
import { applyPreset, createBody, FALLBACK_DEFAULTS, initialDraft, parseOptionalNumber, suggestRepoName, validateDraft, validateExtraGoal, validateOwner } from './form';

const preset: BuildPreset = {
  key: 'minimal-pytorch',
  label: 'Minimal PyTorch',
  description: 'The least code that trains.',
  goal: 'a minimal PyTorch implementation for learning',
  stack: 'PyTorch',
  toolchains: ['python'],
  stops: { max_minutes: 60, max_budget_usd: null, done_when: ['the model trains on a toy task'] },
};

const defaults = { ...FALLBACK_DEFAULTS, max_commits: 12, max_budget_usd: 3, visibility: 'public' as const };

describe('suggestRepoName', () => {
  it('turns a title into a slug a repo can use', () => {
    expect(suggestRepoName('Attention Is All You Need')).toBe('attention-is-all-you-need');
    expect(suggestRepoName('Über “Graphs”: a Survey!')).toBe('uber-graphs-a-survey');
    expect(suggestRepoName('***')).toBe('paper-build');
    expect(suggestRepoName('a'.repeat(80)).length).toBe(48);
  });
});

describe('presets', () => {
  it('fill goal, stack and stops, keeping your default where the preset says nothing', () => {
    const draft = applyPreset(initialDraft(defaults, 'attn'), preset, defaults);
    expect(draft).toMatchObject({
      preset: 'minimal-pytorch',
      goal: preset.goal,
      stack: 'PyTorch',
      doneWhen: ['the model trains on a toy task'],
      maxMinutes: 60,
      maxCommits: 12,
      maxBudget: 3,
      repoName: 'attn',
      visibility: 'public',
    });
  });

  it('go back to the defaults for something else', () => {
    const chosen = applyPreset(initialDraft(defaults, 'attn'), preset, defaults);
    expect(applyPreset(chosen, null, defaults)).toMatchObject({ preset: null, goal: '', stack: '', doneWhen: [], maxMinutes: 90 });
  });
});

describe('validateDraft', () => {
  const valid = { ...initialDraft(FALLBACK_DEFAULTS, 'attn'), goal: 'a small transformer' };

  it('accepts a draft within every limit, and a blank repo name', () => {
    expect(validateDraft(valid)).toEqual({});
    expect(validateDraft({ ...valid, repoName: '  ' })).toEqual({});
  });

  it('names each field outside the backend limits', () => {
    const errors = validateDraft({
      ...valid,
      goal: 'short',
      repoName: 'has space',
      maxMinutes: 4,
      maxCommits: 201,
      maxBudget: 0.25,
      doneWhen: Array.from({ length: 11 }, (_, i) => `line ${i}`),
    });
    expect(Object.keys(errors).sort()).toEqual(['doneWhen', 'goal', 'maxBudget', 'maxCommits', 'maxMinutes', 'repoName']);
  });

  it('checks the length of each done-when line, ignoring blank ones', () => {
    expect(validateDraft({ ...valid, doneWhen: ['', 'x'.repeat(301)] }).doneWhen).toMatch(/300/);
    expect(validateDraft({ ...valid, doneWhen: Array.from({ length: 12 }, (_, i) => (i < 10 ? 'ok' : ' ')) })).toEqual({});
  });
});

describe('createBody', () => {
  it('trims, drops blank lines and sends null for empty options', () => {
    const draft = { ...initialDraft(FALLBACK_DEFAULTS, ' attn '), goal: ' build it ', doneWhen: ['tests pass ', ''], owner: ' ' };
    expect(createBody(draft)).toEqual({
      goal: 'build it',
      preset: null,
      options: {
        repo_name: 'attn',
        visibility: 'private',
        owner: null,
        claude_attribution: false,
        link_paper: true,
        stack: null,
        allow_web: false,
        context: { sections: null, notes: null },
        references: [],
        advanced: ADVANCED_DEFAULTS,
      },
      stops: { max_minutes: 90, max_commits: 30, max_budget_usd: null, done_when: ['tests pass'] },
    });
  });

  it('sends the sections kept, your notes, trimmed references and the full advanced object', () => {
    const draft = {
      ...initialDraft(FALLBACK_DEFAULTS, 'attn'),
      goal: 'build it well',
      visibility: 'local' as const,
      sectionsOff: ['equations' as const, 'claims' as const],
      notes: '  use the small dataset ',
      references: [{ kind: 'url' as const, url: 'https://x.org', document_id: null, title: ' X ', note: '  ', snapshot: true }],
      advanced: { ...ADVANCED_DEFAULTS, delivery: 'pull_request' as const, instructions: '  ', description: ' A repo ' },
    };
    const options = createBody(draft).options;
    expect(options.context).toEqual({ sections: ['tldr', 'question', 'core_ideas', 'how_it_works', 'setup', 'results', 'limitations'], notes: 'use the small dataset' });
    expect(options.references).toEqual([{ kind: 'url', url: 'https://x.org', document_id: null, title: 'X', note: null, snapshot: true }]);
    // A local build cannot open a pull request: it commits on main.
    expect(options.advanced).toEqual({ ...ADVANCED_DEFAULTS, delivery: 'push_main', instructions: null, description: 'A repo' });
  });

  it('starts the advanced options from your settings', () => {
    const draft = initialDraft({ ...FALLBACK_DEFAULTS, advanced: { ...FALLBACK_DEFAULTS.advanced, model: 'opus', tests: 'smoke' } }, 'attn');
    expect(draft.advanced).toEqual({ ...ADVANCED_DEFAULTS, model: 'opus', tests: 'smoke' });
  });

  it('checks notes, references and advanced values as the backend does', () => {
    const draft = {
      ...initialDraft(FALLBACK_DEFAULTS, 'attn'),
      goal: 'build it well',
      notes: 'x'.repeat(8001),
      references: [{ kind: 'url' as const, url: 'https://x.org', document_id: null, title: '', note: null, snapshot: true }],
      advanced: { ...ADVANCED_DEFAULTS, extra_commands: ['rm -rf /'], topics: ['Not A Topic'], instructions: 'x'.repeat(4001) },
    };
    expect(Object.keys(validateDraft(draft)).sort()).toEqual(['extraCommands', 'instructions', 'notes', 'references', 'topics']);
  });
});

describe('owner and extra goal', () => {
  it('takes a GitHub name or nothing', () => {
    expect(validateOwner('')).toBeNull();
    expect(validateOwner('my-lab')).toBeNull();
    expect(validateOwner('my_lab')).toMatch(/GitHub name/);
    expect(validateOwner('x'.repeat(40))).toMatch(/GitHub name/);
  });

  it('lets Continue go without an extra goal, but not with a scrap of one', () => {
    expect(validateExtraGoal('  ')).toBeNull();
    expect(validateExtraGoal('more')).toMatch(/at least 10/);
    expect(validateExtraGoal('add a training notebook')).toBeNull();
  });
});

describe('parseOptionalNumber', () => {
  it('reads empty as no value and garbage as not a number', () => {
    expect(parseOptionalNumber('')).toBeNull();
    expect(parseOptionalNumber('2.5')).toBe(2.5);
    expect(parseOptionalNumber('x')).toBeNaN();
  });
});
