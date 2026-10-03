-- Plan versions (docs/BUILDS.md §7b): every plan a build ever had, append-only, like
-- `paper_syntheses`. `builds.plan` stays the current plan (a copy); `builds.plan_version`
-- names which version it is. A restore moves `plan_version` without writing a row; the next
-- edit or replan appends max + 1 with `based_on` = the version it started from.
create table build_plans (
  id          uuid primary key default gen_random_uuid(),
  build_id    uuid not null references builds on delete cascade,
  version     int  not null check (version >= 1),
  plan        jsonb not null,
  origin      text not null check (origin in ('skill', 'human')),
  feedback    text check (length(feedback) <= 4000),
  based_on    int check (based_on >= 1 and based_on < version),
  model       text,
  created_at  timestamptz not null default now(),
  unique (build_id, version)  -- also the index on build_id
);

alter table builds add column plan_version int check (plan_version >= 1);

-- Backfill: each build that has a plan gets it as v1.
insert into build_plans (build_id, version, plan, origin, created_at)
select id, 1, plan, coalesce(plan_origin, 'skill'), updated_at
from builds
where plan is not null;
update builds set plan_version = 1 where plan is not null;

-- Supabase Data API lockdown, as for every other table.
alter table build_plans enable row level security;
