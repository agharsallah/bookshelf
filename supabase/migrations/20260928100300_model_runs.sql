-- Pipeline telemetry: one row per `claude -p` call a job makes (app/telemetry/recorder.py).
-- `jobs.cost_tokens` / `jobs.duration_ms` describe the job's last successful attempt only;
-- this table also keeps schema retries, failed attempts, each dedup verdict, cache tokens,
-- the CLI's reported cost and the model's own time, so per-book and per-skill statistics
-- (app/stats) can say where tokens and minutes actually go. Append-only, derived (D1).
create table model_runs (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid references jobs on delete cascade,
  document_id        uuid references documents on delete cascade,
  kind               text        not null,              -- the job's kind
  skill              text,
  skill_version      text,
  tier               text        check (tier in ('explore', 'distil', 'reason')),
  model              text,                              -- resolved by the CLI
  attempt            integer     not null default 1 check (attempt >= 1),  -- the job's attempt
  call               integer     not null default 1 check (call >= 1),     -- nth call in it
  ok                 boolean     not null,
  error              text,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  cost_usd           numeric(12, 6),
  duration_ms        integer     not null check (duration_ms >= 0),  -- wall clock of the call
  api_ms             integer,                           -- time inside model API calls
  turns              integer,
  prompt_chars       integer     not null check (prompt_chars >= 0),
  reply_chars        integer,
  images             integer     not null default 0 check (images >= 0),
  created_at         timestamptz not null default now()
);
create index model_runs_document_idx on model_runs (document_id, created_at);
create index model_runs_job_idx on model_runs (job_id);
create index model_runs_skill_idx on model_runs (skill, created_at);

-- Supabase Data API lockdown, as for every other table.
alter table model_runs enable row level security;
