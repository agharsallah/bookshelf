-- Pills (docs/PILLS.md): a vertical feed of one-idea, cited learning cards.
--
--   pills          DERIVED (D1): harvested from approved or preferred-draft artifacts, or
--                  composed by make-pills (`pill_set`). Rebuildable: a harvest upserts by
--                  `source_key` and retires (never deletes) the rows it no longer produces,
--                  so events keep pointing at them.
--   pill_sessions  HUMAN: a feed session (config, seed, the pills served in order).
--   pill_events    HUMAN: what you did with a pill; ids are client-made, so retries no-op.
--   feeds          HUMAN: saved feed configs.
create table pills (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references documents on delete cascade,
  anchor             text not null check (length(anchor) between 1 and 200),  -- the unit
  kind               text not null check (kind in (
                       'insight', 'remember', 'antipattern', 'quote', 'definition', 'number',
                       'figure', 'diagram', 'quiz', 'flip', 'claim', 'math', 'connection',
                       'listen', 'hook')),  -- every pill kind but `review` (never stored)
  headline           text check (length(headline) between 1 and 200),
  body               jsonb not null,  -- the kind's body (contracts/pill.schema.json)
  cites              text[] not null default '{}',  -- `<slug>:<anchor>` when cross-document
  concepts           text[] not null default '{}',
  thread_key         text check (length(thread_key) between 1 and 200),
  thread_index       int check (thread_index >= 0),
  thread_title       text check (length(thread_title) <= 300),
  est_seconds        int not null check (est_seconds between 1 and 600),
  origin             text not null check (origin ~ '^(harvest:[a-z_]+|skill:[a-z0-9-]+@[A-Za-z0-9._-]+)$'),
  source_artifact_id uuid references artifacts on delete set null,
  source_key         text not null check (length(source_key) between 1 and 200),
  draft              boolean not null default false,
  created_at         timestamptz not null default now(),
  retired_at         timestamptz,
  unique (source_key),
  check ((thread_key is null) = (thread_index is null))
);
create index pills_live_unit_idx on pills (document_id, anchor) where retired_at is null;
create index pills_document_idx on pills (document_id);
create index pills_artifact_idx on pills (source_artifact_id);
create index pills_thread_idx on pills (thread_key, thread_index) where thread_key is not null;

create table pill_sessions (
  id          uuid primary key default gen_random_uuid(),
  config      jsonb not null,
  seed        bigint not null,
  served      uuid[] not null default '{}',  -- pill ids in order (review pills: the item id)
  position    int not null default 0 check (position >= 0),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index pill_sessions_created_idx on pill_sessions (created_at desc);

create table pill_events (
  id             uuid primary key,  -- client-generated: a retried batch is a no-op
  session_id     uuid references pill_sessions on delete set null,
  pill_id        uuid references pills on delete cascade,
  review_item_id uuid references review_items on delete cascade,
  kind           text not null check (kind in (
                   'seen', 'dwell', 'answer', 'save', 'unsave', 'skip', 'too_easy',
                   'confusing', 'open_source')),
  value          jsonb,  -- dwell: {ms}; answer: {correct, choice?}
  at             timestamptz not null,
  check (pill_id is not null or review_item_id is not null)
);
create index pill_events_pill_idx on pill_events (pill_id);
create index pill_events_session_idx on pill_events (session_id);
create index pill_events_review_item_idx on pill_events (review_item_id);
create index pill_events_at_idx on pill_events (at);

create table feeds (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 120),
  config     jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger feeds_touch before update on feeds
  for each row execute function touch_updated_at();

-- Vocabularies (every value restated).
alter table artifacts drop constraint artifacts_type_check;
alter table artifacts add constraint artifacts_type_check check (type in (
  'outline_override', 'figure_description', 'code_explanation',
  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
  'section_note', 'chapter_distillation', 'book_brief', 'book_guide', 'structured_note',
  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary', 'audio_summary',
  'salience_marks',
  'paper_card', 'paper_explainer', 'claim_set', 'results_table', 'citation_intents',
  'paper_assessment', 'paper_review', 'notation_table', 'journal_club', 'math_explainer',
  'catalogue_entry', 'pill_set'));

alter table review_items drop constraint review_items_source_check;
alter table review_items add constraint review_items_source_check check (source in (
  'recall', 'question', 'flashcard', 'pill'));

alter table activity_minutes drop constraint activity_minutes_surface_check;
alter table activity_minutes add constraint activity_minutes_surface_check check (surface in (
  'read', 'listen', 'study', 'recall', 'review', 'distill', 'explore', 'pills'));

alter table jobs drop constraint jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in (
  'parse', 'describe_figure', 'explain_code', 'describe_math', 'explain_table',
  'summarize', 'distil_section', 'distil_chapter', 'brief', 'structure_note',
  'embed', 'link_concepts', 'derive', 'export', 'narrate', 'grade_recall',
  'distil_paper_section', 'dissect_paper', 'link_paper_concepts',
  'paper_structure', 'paper_enrich', 'paper_candidates', 'paper_watch', 'paper_fetch',
  'relate_claims', 'recommend_next', 'synthesize_papers',
  'build_plan', 'build_run', 'harvest_pills'));

-- Supabase Data API lockdown, as for every other table.
alter table pills enable row level security;
alter table pill_sessions enable row level security;
alter table pill_events enable row level security;
alter table feeds enable row level security;
