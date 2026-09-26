-- Worker liveness: every worker process (standalone or inside the API) keeps one row here
-- fresh while it polls, so the API can tell "queued, a worker will pick it up" from
-- "queued, and nothing is running to pick it up" — a stall that was invisible before.
-- A clean stop deletes the row; a crashed worker's row simply goes stale (`seen_at`).
create table workers (
  id          uuid primary key,
  name        text        not null,               -- host:pid, for humans
  kinds       text[]      not null default '{}',  -- job kinds it claims
  concurrency integer     not null check (concurrency > 0),
  running     integer     not null default 0 check (running >= 0),
  started_at  timestamptz not null default now(),
  seen_at     timestamptz not null default now()
);
create index workers_seen_idx on workers (seen_at);

-- Supabase Data API lockdown, as for every other table.
alter table workers enable row level security;
