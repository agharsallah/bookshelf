/** Fixtures for the build island tests: a build in any state, its plan, presets, preflight. */
import { ADVANCED_DEFAULTS, type BuildContextView, type BuildOptions, type BuildPlan, type BuildPlanVersion, type BuildPreset, type BuildPublic, type ContextPreview, type Preflight, type PreflightCheck } from '../../lib/api/types/builds';

export const plan = (over: Partial<BuildPlan> = {}): BuildPlan => ({
  summary: 'A tiny transformer that trains on a toy copy task.',
  stack: ['Python', 'PyTorch'],
  repo_name: 'tiny-transformer',
  milestones: [
    { title: 'Scaffold', commit: 'chore: scaffold the project', deliverable: 'A package and a test runner.', done_when: 'pytest runs' },
    { title: 'Attention', commit: 'feat(model): scaled dot-product attention', deliverable: 'attention.py', done_when: 'shapes test passes' },
    { title: 'Train', commit: 'feat(train): train on the copy task', deliverable: 'train.py', done_when: 'loss falls below 0.1' },
  ],
  layout: [{ path: 'src/model.py', purpose: 'The model' }],
  out_of_scope: ['Multi-GPU training'],
  risks: ['Slow on CPU'],
  questions: ['Should it use a tokenizer library?'],
  ...over,
});

export const options = (over: Partial<BuildOptions> = {}): BuildOptions => ({
  repo_name: '',
  visibility: 'private',
  owner: 'me',
  claude_attribution: false,
  link_paper: true,
  stack: 'PyTorch',
  allow_web: false,
  context: { sections: null, notes: null },
  references: [],
  advanced: { ...ADVANCED_DEFAULTS },
  ...over,
});

export const build = (over: Partial<BuildPublic> = {}): BuildPublic => ({
  id: 'b1',
  document_id: 'doc-1',
  agent: 'build-from-paper',
  preset: null,
  goal: 'a minimal PyTorch transformer for learning',
  options: options(),
  stops: { max_minutes: 90, max_commits: 30, max_budget_usd: null, done_when: [] },
  plan: plan(),
  plan_origin: 'skill',
  plan_feedback: null,
  plan_version: 1,
  plan_versions_count: 1,
  state: 'planned',
  stop_reason: null,
  stop_requested: false,
  repo_url: null,
  pr_url: null,
  commits: [],
  events: [],
  report: null,
  cost_usd: null,
  error: null,
  plan_job_id: 'j1',
  run_job_id: null,
  started_at: null,
  finished_at: null,
  created_at: '2026-10-03T10:00:00Z',
  updated_at: '2026-10-03T10:00:00Z',
  elapsed_seconds: null,
  ...over,
});

export const presets: BuildPreset[] = [
  {
    key: 'minimal-pytorch',
    label: 'Minimal PyTorch',
    description: 'The least code that trains.',
    goal: 'a minimal PyTorch implementation, least code possible',
    stack: 'PyTorch',
    toolchains: ['python'],
    stops: { max_minutes: 60, max_commits: 15, done_when: ['it trains on a toy task'] },
  },
];

export const check = (over: Partial<PreflightCheck> = {}): PreflightCheck => ({ key: 'gh_auth', ok: true, level: 'error', message: 'gh is signed in', fix: null, ...over });

export const preflightOf = (...checks: PreflightCheck[]): Preflight => ({ ready: !checks.some((c) => !c.ok && c.level === 'error'), checks });

/** `GET /papers/{ref}/builds/context`: three sections and a suggestion from each source. */
export const contextPreview = (over: Partial<ContextPreview> = {}): ContextPreview => ({
  header: '# Attention Is All You Need',
  sections: [
    { key: 'tldr', title: 'TL;DR', markdown: 'Attention alone is enough.', words: 40 },
    { key: 'equations', title: 'Equations', markdown: '$softmax(QK^T)V$', words: 300 },
    { key: 'results', title: 'Results', markdown: '| BLEU | 28.4 |', words: 1500 },
  ],
  suggested_references: [
    { kind: 'url', url: 'https://github.com/tensorflow/tensor2tensor', document_id: null, title: 'tensor2tensor', source: 'code' },
    { kind: 'url', url: 'https://arxiv.org/abs/1706.03762', document_id: null, title: 'arXiv 1706.03762', source: 'paper' },
    { kind: 'shelf', url: null, document_id: 'doc-bahdanau', title: 'Neural Machine Translation by Jointly Learning to Align', source: 'shelf' },
  ],
  ...over,
});

/** What a build received: two files, its kickoff, its tools. */
export const contextView = (over: Partial<BuildContextView> = {}): BuildContextView => ({
  files: [
    { path: 'docs/PAPER.md', content: '# Attention\n\nAttention alone is enough.', words: 5 },
    { path: 'docs/REFERENCES.md', content: '- tensor2tensor', words: 2 },
  ],
  kickoff: 'Build a tiny transformer.',
  agent_brief: 'You are a careful engineer.',
  allowed_tools: ['Read', 'Write', 'Bash(git commit:*)', 'Bash(make:*)'],
  command: ['claude', '-p', '--model', 'sonnet'],
  model: 'sonnet',
  effort: 'high',
  plan_input: null,
  source: 'workspace',
  ...over,
});

/** A version of the plan (`GET /builds/{id}/plans`): v1, drafted by the planner, by default. */
export const planVersion = (over: Partial<BuildPlanVersion> = {}): BuildPlanVersion => ({
  version: 1,
  plan: plan(),
  origin: 'skill',
  feedback: null,
  based_on: null,
  model: 'sonnet',
  created_at: '2026-10-03T10:00:00Z',
  current: false,
  ...over,
});
