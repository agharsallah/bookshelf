-- Papers (docs/PAPERS.md §1, §2): a scientific paper is a document with `genre = 'paper'`
-- (P1), run through its own pipeline profile, skills and tables. This migration lays the
-- whole data foundation at once, so later stages never widen a vocabulary again:
--
--  * documents.genre: what the text is (book | paper | article); `kind` stays the file
--    format. Web articles already ingested become genre 'article'.
--  * paper_meta: one row per paper (identifiers, venue, abstract, OpenAlex counts).
--  * paper_references: the bibliography, one row per entry, matched to the shelf and
--    tagged with the citation intent the classify-citations artifact assigns (P5).
--  * claims: materialized from the approved claim_set artifact (P4, P5). Derived.
--  * paper_ratings: YOUR verdict (P8). Append-only: a row is never edited (D11).
--  * paper_passes: three-pass reading progress.
--  * reading_candidates: papers to read next, scored deterministically (P6).
--  * paper_sets / paper_syntheses: user-chosen groups and their literature reviews.
--
-- Widened vocabularies (each list restated in full): artifact types, job kinds, concept
-- kinds (method, dataset, metric, task), edge endpoint kinds (claim), relations (cites).

-- DOCUMENTS ----------------------------------------------------------------------
alter table documents add column genre text not null default 'book'
  check (genre in ('book', 'paper', 'article'));
update documents set genre = 'article' where kind = 'article';
create index documents_genre_idx on documents (genre, created_at desc);

-- PAPER METADATA -----------------------------------------------------------------
create table paper_meta (
  document_id     uuid primary key references documents on delete cascade,
  doi             text check (length(doi) between 1 and 300),
  arxiv_id        text check (length(arxiv_id) between 1 and 64),
  openalex_id     text check (length(openalex_id) between 1 and 64),
  venue           text check (length(venue) between 1 and 500),
  year            int check (year between -3000 and 3000),
  abstract        text check (length(abstract) between 1 and 20000),
  fields          text[] not null default '{}',  -- OpenAlex topics / concepts
  code_urls       text[] not null default '{}',
  data_urls       text[] not null default '{}',
  cited_by_count  int check (cited_by_count >= 0),
  reference_count int check (reference_count >= 0),
  source          text not null default 'parsed'
                    check (source in ('parsed', 'openalex', 'grobid', 'human')),
  enriched_at     timestamptz,
  updated_at      timestamptz not null default now()
);
create index paper_meta_doi_idx on paper_meta (lower(doi)) where doi is not null;
create index paper_meta_arxiv_idx on paper_meta (arxiv_id) where arxiv_id is not null;
create index paper_meta_openalex_idx on paper_meta (openalex_id) where openalex_id is not null;
create trigger paper_meta_touch before update on paper_meta
  for each row execute function touch_updated_at();

-- BIBLIOGRAPHY -------------------------------------------------------------------
create table paper_references (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references documents on delete cascade,
  ordinal            int not null check (ordinal >= 0),  -- [n], or the list position
  anchor             text check (length(anchor) between 1 and 200),  -- the reference block
  raw                text not null check (length(raw) between 1 and 5000),
  title              text check (length(title) between 1 and 1000),
  authors            text[] not null default '{}',
  year               int check (year between -3000 and 3000),
  venue              text check (length(venue) between 1 and 500),
  doi                text check (length(doi) between 1 and 300),
  arxiv_id           text check (length(arxiv_id) between 1 and 64),
  openalex_id        text check (length(openalex_id) between 1 and 64),
  target_document_id uuid references documents on delete set null,  -- on the shelf
  cited_at           text[] not null default '{}',  -- anchors of the in-text citations
  intent             text check (intent in (
                       'background', 'uses', 'extends', 'compares', 'contradicts')),
  intent_cites       text[] not null default '{}',
  created_at         timestamptz not null default now(),
  unique (document_id, ordinal)
);
create index paper_references_target_idx on paper_references (target_document_id)
  where target_document_id is not null;
create index paper_references_doi_idx on paper_references (lower(doi)) where doi is not null;
create index paper_references_openalex_idx on paper_references (openalex_id)
  where openalex_id is not null;

-- CLAIMS (derived from the approved claim_set) -----------------------------------
create table claims (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents on delete cascade,
  artifact_id uuid not null references artifacts on delete cascade,
  key         text not null check (length(key) between 1 and 32),  -- 'C3', stable per claim_set
  text        text not null check (length(text) between 1 and 2000),
  kind        text not null check (kind in (
                'method', 'result', 'theory', 'dataset', 'benchmark', 'position')),
  strength    text not null check (strength in ('measured', 'argued', 'speculated')),
  evidence    text[] not null check (cardinality(evidence) >= 1),  -- anchors
  unit        text check (length(unit) between 1 and 200),  -- the section it belongs to
  created_at  timestamptz not null default now(),
  unique (artifact_id, key)
);
create index claims_document_idx on claims (document_id, unit);

-- YOUR RATING (append-only, latest wins; P8, D11) ---------------------------------
create table paper_ratings (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  verdict     text check (verdict in ('must_read', 'useful', 'skim', 'skip')),
  note        text check (length(note) between 1 and 20000),
  created_at  timestamptz not null default now()
);
create index paper_ratings_document_idx on paper_ratings (document_id, created_at desc);

create function paper_ratings_are_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'paper_ratings are immutable (D11): add a new rating instead';
end;
$$;
create trigger paper_ratings_immutable before update on paper_ratings
  for each row execute function paper_ratings_are_immutable();

-- THREE-PASS READING ---------------------------------------------------------------
create table paper_passes (
  document_id  uuid not null references documents on delete cascade,
  pass         smallint not null check (pass between 1 and 3),
  completed_at timestamptz not null default now(),
  note         text check (length(note) between 1 and 20000),
  primary key (document_id, pass)
);

-- WHAT TO READ NEXT ----------------------------------------------------------------
create table reading_candidates (
  id             uuid primary key default gen_random_uuid(),
  openalex_id    text unique check (length(openalex_id) between 1 and 64),
  doi            text check (length(doi) between 1 and 300),
  arxiv_id       text check (length(arxiv_id) between 1 and 64),
  title          text not null check (length(title) between 1 and 1000),
  authors        text[] not null default '{}',
  year           int check (year between -3000 and 3000),
  venue          text check (length(venue) between 1 and 500),
  abstract       text check (length(abstract) between 1 and 20000),
  pdf_url        text check (length(pdf_url) between 1 and 2048),
  cited_by_count int check (cited_by_count >= 0),
  -- [{kind: reference|cited_by|related|similar|watch, document_id}]
  sources        jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  score          real not null default 0,
  score_parts    jsonb not null default '{}' check (jsonb_typeof(score_parts) = 'object'),
  reason         text check (length(reason) between 1 and 5000),
  reason_cites   text[] not null default '{}',  -- '<document_id>#<anchor>'
  status         text not null default 'suggested'
                   check (status in ('suggested', 'queued', 'dismissed', 'ingested')),
  document_id    uuid references documents on delete set null,  -- once ingested
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index reading_candidates_rank_idx on reading_candidates (status, score desc);
create index reading_candidates_doi_idx on reading_candidates (lower(doi)) where doi is not null;
create index reading_candidates_arxiv_idx on reading_candidates (arxiv_id)
  where arxiv_id is not null;
create index reading_candidates_document_idx on reading_candidates (document_id)
  where document_id is not null;
create trigger reading_candidates_touch before update on reading_candidates
  for each row execute function touch_updated_at();

-- SETS AND SYNTHESES (cross-document) -----------------------------------------------
create table paper_sets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(name) between 1 and 200),
  document_ids uuid[] not null check (cardinality(document_ids) between 1 and 100),
  created_at   timestamptz not null default now()
);

create table paper_syntheses (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references paper_sets on delete cascade,
  version     int not null check (version >= 1),
  body        jsonb not null,
  citations   text[] not null default '{}',  -- '<slug>:<anchor>' across the set
  origin      text not null check (length(origin) between 1 and 200),  -- skill:synthesize-papers@<v>
  model       text,
  input_hash  text not null check (length(input_hash) between 1 and 200),
  review      text not null default 'draft'
                check (review in ('draft', 'needs_review', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  unique (set_id, version)
);

-- WIDENED VOCABULARIES ---------------------------------------------------------------
alter table artifacts drop constraint artifacts_type_check;
alter table artifacts add constraint artifacts_type_check check (type in (
  'outline_override', 'figure_description', 'code_explanation',
  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
  'section_note', 'chapter_distillation', 'book_brief', 'book_guide', 'structured_note',
  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary', 'audio_summary',
  'salience_marks',
  'paper_card', 'paper_explainer', 'claim_set', 'results_table', 'citation_intents',
  'paper_assessment', 'paper_review', 'notation_table', 'journal_club'));

-- Paper stage skills get their own kinds (the kind picks the skill); paper by-products
-- (simplify, claims, results, citations, assess, review, notation, journal club) run as
-- `derive` jobs naming their skill. The rest are Python jobs (utility skills inline).
alter table jobs drop constraint jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in (
  'parse', 'describe_figure', 'explain_code', 'describe_math', 'explain_table',
  'summarize', 'distil_section', 'distil_chapter', 'brief', 'structure_note',
  'embed', 'link_concepts', 'derive', 'export', 'narrate', 'grade_recall',
  'distil_paper_section', 'dissect_paper', 'link_paper_concepts',
  'paper_structure', 'paper_enrich', 'paper_candidates', 'paper_watch', 'paper_fetch',
  'relate_claims', 'recommend_next', 'synthesize_papers'));

alter table concepts drop constraint concepts_kind_check;
alter table concepts add constraint concepts_kind_check check (kind in (
  'concept', 'framework', 'person', 'work', 'term',
  'method', 'dataset', 'metric', 'task'));

alter table edges drop constraint edges_src_kind_check;
alter table edges add constraint edges_src_kind_check
  check (src_kind in ('node', 'concept', 'artifact', 'document', 'claim'));
alter table edges drop constraint edges_dst_kind_check;
alter table edges add constraint edges_dst_kind_check
  check (dst_kind in ('node', 'concept', 'artifact', 'document', 'claim'));

-- `cites`: document → document, from paper_references.target_document_id (derived).
alter table edges drop constraint edges_relation_check;
alter table edges add constraint edges_relation_check check (relation in (
  'mentions', 'defines', 'supports', 'contradicts', 'extends',
  'example_of', 'same_as', 'echoes', 'cites'));

-- Supabase Data API lockdown, as for every other table.
alter table paper_meta enable row level security;
alter table paper_references enable row level security;
alter table claims enable row level security;
alter table paper_ratings enable row level security;
alter table paper_passes enable row level security;
alter table reading_candidates enable row level security;
alter table paper_sets enable row level security;
alter table paper_syntheses enable row level security;
