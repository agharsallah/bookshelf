-- Which agent made a model call, and where to find a Cursor run again.
-- Existing rows are Claude CLI calls. `external_run_id` is the Cursor CLI session id
-- (`agent --resume <id>`), null for Claude.
alter table model_runs
  add column runtime text not null default 'claude'
    check (runtime in ('claude', 'cursor')),
  add column external_run_id text;

create index model_runs_external_run_idx on model_runs (external_run_id)
  where external_run_id is not null;
