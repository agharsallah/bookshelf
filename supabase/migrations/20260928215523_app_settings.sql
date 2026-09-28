-- App settings: one row of choices that steer the server (today: which study material a new
-- document makes on its own once it is distilled). `data` holds only what was set; anything
-- absent takes its default in `app/services/app_settings.py`. Display preferences (theme,
-- layout, reader type) stay in the browser.
create table app_settings (
  id         smallint    primary key default 1 check (id = 1),
  data       jsonb       not null default '{}',
  updated_at timestamptz not null default now()
);

-- Supabase Data API lockdown, as for every other table.
alter table app_settings enable row level security;
