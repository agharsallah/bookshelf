-- Remembering what you read (§9 "Remembering it"): closed-book recall, predictions, and
-- spaced retrieval reviews.
--
--  * recalls: what you wrote from memory at the end of a chapter (kind `recall`), or what
--    you expected a chapter to argue before reading it (kind `prediction`). Your words,
--    like notes.raw: a row is never edited (D11), only deleted.
--  * recall_grades: how a recall compares with the chapter's key ideas, written by the
--    grade-recall skill. Derived: re-grading replaces the row.
--  * review_items: what comes back for spaced retrieval — ideas a recall missed, the
--    "why" question it asked, flashcards you marked. `card` is the FSRS card state and
--    `due` is copied out of it, so "due today across all books" is one indexed query.
--  * review_logs: every review you did, with what you typed before revealing the answer.

create table recalls (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents on delete cascade,
  unit        text not null check (length(unit) between 1 and 200),  -- the chapter anchor
  kind        text not null check (kind in ('recall', 'prediction')),
  raw         text not null check (length(raw) between 1 and 20000),
  created_at  timestamptz not null default now()
);
create index recalls_unit_idx on recalls (document_id, unit, created_at desc);

create function recalls_are_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'recalls are immutable (D11)';
end;
$$;
create trigger recalls_immutable before update on recalls
  for each row execute function recalls_are_immutable();

create table recall_grades (
  recall_id     uuid primary key references recalls on delete cascade,
  prediction_id uuid references recalls on delete set null,  -- the prediction compared, if any
  ideas         jsonb not null,  -- [{id, tier, text, cites, status, feedback, cue?}]
  question      jsonb,           -- {idea, text}: one "why is this true?" about a recalled idea
  comparison    jsonb,           -- {predicted, argues, cites}: the prediction against the thesis
  origin        text not null,   -- skill:grade-recall@<v>
  model         text,
  created_at    timestamptz not null default now()
);
create index recall_grades_prediction_idx on recall_grades (prediction_id);

create table review_items (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents on delete cascade,
  anchor      text not null check (length(anchor) between 1 and 200),  -- the passage it rests on
  source      text not null check (source in ('recall', 'question', 'flashcard')),
  source_key  text not null check (length(source_key) between 1 and 200),
  prompt      text not null check (length(prompt) between 1 and 2000),
  answer      jsonb not null,  -- spans [{text, cites}]: shown once you have typed an answer
  card        jsonb not null,  -- FSRS card state (py-fsrs Card.to_dict)
  due         timestamptz not null,
  last_rating smallint check (last_rating between 1 and 4),
  created_at  timestamptz not null default now(),
  unique (source, source_key)
);
create index review_items_due_idx on review_items (due);
create index review_items_document_idx on review_items (document_id);

create table review_logs (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references review_items on delete cascade,
  rating      smallint not null check (rating between 1 and 4),
  answer      text check (length(answer) <= 20000),  -- what you typed; null for a flashcard mark
  reviewed_at timestamptz not null default now()
);
create index review_logs_item_idx on review_logs (item_id, reviewed_at);

alter table jobs drop constraint jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in (
  'parse', 'describe_figure', 'explain_code', 'describe_math', 'explain_table',
  'summarize', 'distil_section', 'distil_chapter', 'brief', 'structure_note',
  'embed', 'link_concepts', 'derive', 'export', 'narrate', 'grade_recall'));

-- Supabase Data API lockdown, as for every other table.
alter table recalls enable row level security;
alter table recall_grades enable row level security;
alter table review_items enable row level security;
alter table review_logs enable row level security;
