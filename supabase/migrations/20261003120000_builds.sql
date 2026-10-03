-- Builds (docs/BUILDS.md): a paper's ideas turned into a fresh git repository by a Claude
-- Code agent. A build is planned first (`build_plan`, the plan-build utility skill), then,
-- once you approve the plan, built milestone by milestone (`build_run`, an agentic CLI run
-- on its own single-slot runner). Options, stops, plan, commits, events and the final report
-- are jsonb, shaped by `app/schemas/builds.py`.
create table builds (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references documents on delete cascade,
  agent          text not null default 'build-from-paper'
                 check (agent ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),       -- agents/<name>
  preset         text check (length(preset) between 1 and 100),    -- presets.yaml key
  goal           text not null check (length(goal) between 10 and 4000),
  options        jsonb not null,
  stops          jsonb not null,
  plan           jsonb,
  plan_origin    text check (plan_origin in ('skill', 'human')),
  plan_feedback  text check (length(plan_feedback) <= 4000),
  state          text not null default 'planning' check (state in (
                   'planning', 'planned', 'building', 'stopping', 'done', 'stopped', 'failed')),
  stop_reason    text check (stop_reason in (
                   'goal_reached', 'max_minutes', 'max_commits', 'max_budget', 'user',
                   'agent_gave_up', 'error')),
  stop_requested boolean not null default false,
  repo_url       text,
  workspace      text,
  session_id     uuid,
  commits        jsonb not null default '[]'::jsonb,
  events         jsonb not null default '[]'::jsonb,
  report         jsonb,
  cost_usd       numeric(10, 4) check (cost_usd >= 0),
  error          text,
  plan_job_id    uuid references jobs on delete set null,
  run_job_id     uuid references jobs on delete set null,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index builds_document_idx on builds (document_id, created_at desc);
create index builds_plan_job_idx on builds (plan_job_id);
create index builds_run_job_idx on builds (run_job_id);
create trigger builds_touch before update on builds
  for each row execute function touch_updated_at();

alter table jobs drop constraint jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in (
  'parse', 'describe_figure', 'explain_code', 'describe_math', 'explain_table',
  'summarize', 'distil_section', 'distil_chapter', 'brief', 'structure_note',
  'embed', 'link_concepts', 'derive', 'export', 'narrate', 'grade_recall',
  'distil_paper_section', 'dissect_paper', 'link_paper_concepts',
  'paper_structure', 'paper_enrich', 'paper_candidates', 'paper_watch', 'paper_fetch',
  'relate_claims', 'recommend_next', 'synthesize_papers',
  'build_plan', 'build_run'));

-- Supabase Data API lockdown, as for every other table.
alter table builds enable row level security;
