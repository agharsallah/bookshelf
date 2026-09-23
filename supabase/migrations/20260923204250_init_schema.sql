-- Bookshelf initial schema (docs/ARCHITECTURE.md §6).
--
-- Source of truth: documents, nodes, notes (raw), artifacts with origin = human.
-- Everything else (skill artifacts, concepts, edges, the Qdrant index) is derived and
-- rebuildable by re-running jobs (D1).
--
-- RLS is enabled on every table with no policies: the Supabase Data API (anon /
-- authenticated roles) sees nothing. The FastAPI backend connects as the table owner,
-- which bypasses RLS, and is the only reader/writer.

create extension if not exists pgcrypto;

-- SOURCE ---------------------------------------------------------------------
create table documents (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('pdf', 'article')),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title         text not null check (length(title) between 1 and 500),
  authors       text[] not null default '{}',
  year          int check (year between -3000 and 3000),
  source_uri    text,
  source_path   text,
  sha256        text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count    int check (page_count >= 0),
  language      text not null default 'en',
  status        text not null default 'registered' check (status in (
                  'registered', 'parsing', 'parse_failed', 'parsed', 'needs_review',
                  'enriching', 'distilling', 'distilled', 'indexed', 'linked', 'deriving')),
  parse_tier    int check (parse_tier between 1 and 3),
  -- Manual chapter/section fix-up (§8). Survives re-parsing; the parser applies it.
  outline_override jsonb,
  tags          text[] not null default '{}',
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (source_uri is not null or source_path is not null)
);
create index documents_status_idx on documents (status);
create index documents_tags_idx on documents using gin (tags);
create index documents_authors_idx on documents using gin (authors);

-- STRUCTURE ------------------------------------------------------------------
create table nodes (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents on delete cascade,
  parent_id     uuid references nodes on delete cascade,
  anchor        text not null,
  kind          text not null check (kind in (
                  'part', 'chapter', 'section', 'paragraph', 'list', 'table', 'figure',
                  'code', 'math', 'aside', 'quote')),
  ordinal       int  not null check (ordinal >= 0),
  depth         int  not null check (depth >= 0),
  heading       text,
  text          text,
  content_hash  text,
  page_from     int,
  page_to       int,
  meta          jsonb not null default '{}',
  -- Exact-phrase / lexical search over source text (§10 "Lexical" intent).
  tsv           tsvector generated always as (
                  to_tsvector('english', coalesce(heading, '') || ' ' || coalesce(text, ''))
                ) stored,
  unique (document_id, anchor),
  check (page_from is null or page_to is null or page_to >= page_from)
);
create index nodes_tree_idx on nodes (document_id, parent_id, ordinal);
create index nodes_kind_idx on nodes (document_id, kind);
create index nodes_anchor_prefix_idx on nodes (document_id, anchor text_pattern_ops);
create index nodes_tsv_idx on nodes using gin (tsv);

-- HUMAN ----------------------------------------------------------------------
create table notes (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents on delete cascade,
  anchor        text not null,
  range         jsonb,
  raw           text not null check (length(raw) between 1 and 20000),
  color         text check (color in ('amber', 'rose', 'sage', 'sky', 'violet')),
  created_at    timestamptz not null default now(),
  foreign key (document_id, anchor) references nodes (document_id, anchor) on delete cascade
);
create index notes_document_anchor_idx on notes (document_id, anchor);

-- D11: your words are never rewritten. Enforced in the database, not just the API.
create function notes_raw_is_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.raw is distinct from old.raw then
    raise exception 'notes.raw is immutable (D11)';
  end if;
  return new;
end $$;
create trigger notes_raw_immutable before update on notes
  for each row execute function notes_raw_is_immutable();

-- DISTILLATION ---------------------------------------------------------------
create table artifacts (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents on delete cascade,
  anchor        text,
  note_id       uuid references notes on delete cascade,
  type          text not null check (type in (
                  'outline_override', 'figure_description', 'code_explanation',
                  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
                  'section_note', 'chapter_distillation', 'book_brief', 'structured_note',
                  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary')),
  version       int  not null check (version >= 1),
  origin        text not null check (origin in ('human', 'skill')),
  skill         text,
  skill_version text,
  model         text,
  run_mode      text check (run_mode in ('batch', 'interactive')),
  tier          text check (tier in ('explore', 'distil', 'reason')),
  input_hash    text not null,
  body          jsonb not null,
  citations     text[] not null default '{}',
  -- Gate results (§14): grounding score, compression ratio, flags. Kept for trend lines.
  gates         jsonb not null default '{}',
  review        text not null default 'draft'
                  check (review in ('draft', 'needs_review', 'approved', 'rejected')),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  check ((origin = 'human') = (skill is null)),
  -- Scope-less rows (anchor null) still need unique versions.
  unique nulls not distinct (document_id, anchor, type, version)
);
create index artifacts_doc_type_review_idx on artifacts (document_id, type, review);
create index artifacts_citations_idx on artifacts using gin (citations);
-- Never pay twice for the same input (§14 Idempotency).
create unique index artifacts_idempotency_idx on artifacts (type, input_hash, skill_version)
  where review <> 'rejected';

-- CONNECTION -----------------------------------------------------------------
create table concepts (
  id            uuid primary key default gen_random_uuid(),
  canonical     text not null unique check (length(canonical) between 1 and 200),
  aliases       text[] not null default '{}',
  kind          text not null check (kind in ('concept', 'framework', 'person', 'work', 'term')),
  blurb         text,
  blurb_cites   text[] not null default '{}',
  -- Set when a human confirms a `same_as` merge; merged concepts stop showing up.
  merged_into   uuid references concepts on delete set null,
  created_at    timestamptz not null default now()
);
create index concepts_aliases_idx on concepts using gin (aliases);

create table edges (
  id            uuid primary key default gen_random_uuid(),
  src_kind      text not null check (src_kind in ('node', 'concept', 'artifact', 'document')),
  src_id        text not null,
  dst_kind      text not null check (dst_kind in ('node', 'concept', 'artifact', 'document')),
  dst_id        text not null,
  relation      text not null check (relation in (
                  'mentions', 'defines', 'supports', 'contradicts', 'extends',
                  'example_of', 'same_as')),
  weight        real not null default 1.0 check (weight >= 0),
  evidence      text[] not null default '{}',
  origin        text not null,
  -- Proposed `same_as` merges wait for a human (§11); other edges start accepted.
  status        text not null default 'accepted' check (status in ('proposed', 'accepted', 'rejected')),
  created_at    timestamptz not null default now(),
  unique (src_kind, src_id, dst_kind, dst_id, relation)
);
create index edges_dst_idx on edges (dst_kind, dst_id, relation);
create index edges_src_idx on edges (src_kind, src_id, relation);

-- ORCHESTRATION --------------------------------------------------------------
-- The jobs table is also the queue: workers claim rows with FOR UPDATE SKIP LOCKED,
-- so there is no Redis to run (deviation from §16 Q3, recorded in ARCHITECTURE.md).
create table jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in (
                  'parse', 'describe_figure', 'explain_code', 'describe_math', 'explain_table',
                  'summarize', 'distil_section', 'distil_chapter', 'brief', 'structure_note',
                  'embed', 'link_concepts', 'derive', 'export')),
  document_id   uuid references documents on delete cascade,
  anchor        text,
  skill         text,
  skill_version text,
  input_hash    text,
  payload       jsonb not null default '{}',
  state         text not null default 'queued'
                  check (state in ('queued', 'running', 'done', 'failed', 'skipped')),
  priority      int  not null default 100,
  attempts      int  not null default 0,
  max_attempts  int  not null default 3,
  run_after     timestamptz not null default now(),
  locked_at     timestamptz,
  error         text,
  result        jsonb,
  cost_tokens   int,
  run_mode      text check (run_mode in ('batch', 'interactive')),
  duration_ms   int,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index jobs_state_kind_idx on jobs (state, kind);
create index jobs_claim_idx on jobs (priority, run_after) where state = 'queued';
create index jobs_document_idx on jobs (document_id, created_at desc);
-- At most one live job per scope: enqueueing the same work twice is a no-op.
create unique index jobs_dedupe_idx
  on jobs (kind, coalesce(document_id::text, ''), coalesce(anchor, ''), coalesce(input_hash, ''))
  where state in ('queued', 'running');

-- updated_at ------------------------------------------------------------------
create function touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger documents_touch before update on documents
  for each row execute function touch_updated_at();

-- Supabase Data API lockdown ----------------------------------------------------
alter table documents enable row level security;
alter table nodes     enable row level security;
alter table notes     enable row level security;
alter table artifacts enable row level security;
alter table concepts  enable row level security;
alter table edges     enable row level security;
alter table jobs      enable row level security;
