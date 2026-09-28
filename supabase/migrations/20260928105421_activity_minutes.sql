-- Reading activity: the seconds you spent, minute by minute, on each surface of the app.
-- The browser keeps an attention clock (visible page, recent input; or audio actually
-- playing) and reports what it counted in batches (`POST /activity`); each report adds
-- to the row of its minute, capped at 60 seconds. One row per minute × surface × place:
--   surface  read · listen · study · recall · review · distill · explore
--   unit     the chapter (reader, chapter listening, recall), '' elsewhere
--   anchor   the block being read, '' when there is none
--   detail   what the surface showed: the study kind, 'brief', 'guide', 'episode', ...
-- It is what the reader statistics (app/reader_stats) compute time, sessions, streaks and
-- most-visited passages from. Anchors are not foreign keys, so a re-parse keeps history.
create table activity_minutes (
  id          bigint      generated always as identity primary key,
  minute      timestamptz not null check (date_trunc('minute', minute) = minute),
  surface     text        not null check (surface in (
                'read', 'listen', 'study', 'recall', 'review', 'distill', 'explore')),
  document_id uuid        references documents on delete cascade,
  unit        text        not null default '' check (length(unit) <= 200),
  anchor      text        not null default '' check (length(anchor) <= 200),
  detail      text        not null default '' check (length(detail) <= 40),
  seconds     smallint    not null check (seconds between 1 and 60),
  constraint activity_minutes_key
    unique nulls not distinct (minute, surface, document_id, unit, anchor, detail)
);
-- The unique key leads with `minute`, so windowed reads use it; per-book reads use this.
create index activity_minutes_document_idx on activity_minutes (document_id, minute);

-- Supabase Data API lockdown, as for every other table.
alter table activity_minutes enable row level security;
