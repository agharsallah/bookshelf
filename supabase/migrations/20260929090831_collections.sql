-- Collections: a hand-gathered group of documents of any genre (books, papers, articles)
-- around one thing you are studying, e.g. "Fine-tuning". A document can sit in many
-- collections; members keep a reading order and an optional note on why they are there.
-- Unlike `paper_sets` (papers only, for synthesis), members are a join table so deleting a
-- document or a collection tidies its memberships.
create table collections (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (length(name) between 1 and 200),
  description text check (length(description) <= 2000),
  colour      text check (length(colour) between 1 and 32),  -- a frontend dye name
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger collections_touch before update on collections
  for each row execute function touch_updated_at();

create table collection_members (
  collection_id uuid not null references collections on delete cascade,
  document_id   uuid not null references documents on delete cascade,
  position      int  not null check (position >= 0),
  note          text check (length(note) <= 2000),
  added_at      timestamptz not null default now(),
  primary key (collection_id, document_id)
);
create index collection_members_document_idx on collection_members (document_id);

-- Supabase Data API lockdown, as for every other table.
alter table collections enable row level security;
alter table collection_members enable row level security;
