-- Reading progress: one row per chapter you have opened in the reader. `anchor` is where
-- to pick up again (the block last read); `progress` is how far through the chapter you
-- have ever got (0–1, never goes back when you scroll up). The book's "continue reading"
-- is its most recently updated row. Anchors are not foreign keys, so a re-parse keeps
-- your place; an anchor that no longer exists just falls back to its chapter.
create table reading_positions (
  document_id uuid        not null references documents on delete cascade,
  unit        text        not null check (length(unit) between 1 and 200),
  anchor      text        not null check (length(anchor) between 1 and 200),
  progress    real        not null check (progress between 0 and 1),
  updated_at  timestamptz not null default now(),
  primary key (document_id, unit)
);
create index reading_positions_recent_idx on reading_positions (document_id, updated_at desc);

-- Supabase Data API lockdown, as for every other table.
alter table reading_positions enable row level security;
