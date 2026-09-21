# Bookshelf — Design & Architecture

**Status**: proposed · **Date**: 2026-09-21 · **Owner**: agharsallah

---

## 1. What this is

A personal knowledge system that turns long-form reading (mostly PDFs, plus articles) into a
**structured, cited, navigable knowledge base** — and keeps the human in the loop.

Three promises, in priority order:

1. **Read once, keep forever.** Every book becomes a chapter-level distillation plus a one-page
   brief, both traceable back to the exact passage they came from.
2. **Ask, don't dig.** Ask a question and get an answer assembled from what you have already
   read, with citations you can click into.
3. **See the connections.** Concepts link across books, so the shelf behaves like one corpus
   rather than a stack of isolated files.

### Explicit non-goals

Named so they stop showing up in scope discussions:

| Not building | Why |
|---|---|
| Generated videos, narration, scripts | Highest cost, lowest knowledge value per hour of work |
| Multi-user accounts, sharing, permissions | Single-user system; auth is one API key (already built) |
| Mobile app | Responsive web is enough |
| Real-time collaborative editing | No second user |
| Web crawling / feed ingestion | Ingest is deliberate: you choose what enters the shelf |
| EPUB, DOCX, audio | PDF and HTML cover the real corpus; the parser interface leaves the seam |

Quizzes, flashcards, and quote extraction **are** in scope, but last (§13) — they are cheap once
the distillation layer exists and worthless before it.

---

## 2. The core idea, enriched

The original idea is "parse, distil, search". The three additions that make it more than a
notes app:

**a. The block is the atom, and it has an address.**
Not pages, not arbitrary 512-token chunks. A *block* is a semantic leaf (paragraph, list, table,
figure caption) that lives at a stable address in the document tree:
`meadows-systems/ch03/s02/p014`. Distillations cite addresses. Notes attach to addresses.
Graph edges point at addresses. Highlights are ranges over addresses. One primitive, and
everything else composes onto it.

**b. Two retrieval tiers, not one RAG blob.**
Search the *distillation* layer to find out **what you know about X**; drop to the *block* layer
to get the **evidence and the exact words**. Most questions are answered from a handful of
chapter distillations — dense, deduplicated, already-written prose — with raw passages pulled in
only for grounding. This is the difference between "a RAG app over book chunks" and a system
that gets better as you read more.

**c. Derived data is disposable.**
Postgres holds the source of truth: document structure, block text, your notes, provenance.
Everything else — Markdown exports, embeddings, the Qdrant index, the concept graph, the briefs
themselves — is derived and rebuildable from scratch by re-running jobs. That single rule is
what makes it safe to iterate aggressively on prompts and parsers.

---

## 3. Four layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ CONNECTION   concepts · typed edges · neighborhoods                  │  derived
├──────────────────────────────────────────────────────────────────────┤
│ DISTILLATION section notes → chapter distillations → book brief      │  derived
│              + your notes, structured (raw kept verbatim)            │  ← human
├──────────────────────────────────────────────────────────────────────┤
│ STRUCTURE    document → parts → chapters → sections → blocks         │  source of truth
│              stable anchors · content hashes · page spans            │
├──────────────────────────────────────────────────────────────────────┤
│ SOURCE       original PDF / HTML, byte-identical, never mutated      │  source of truth
└──────────────────────────────────────────────────────────────────────┘
```

Each layer only reads the layer below it. A distillation never reads another distillation of the
same rank; a chapter distillation is built from *its* section notes, nothing else. That
constraint is what prevents the duplication the idea dump worries about (§9).

---

## 4. System shape

```
                ┌─────────────────────────────────────────────┐
  upload PDF ──▶│  FastAPI  (backend/, already scaffolded)    │
  paste URL     │                                             │
                │  routes ─ services ─ jobs                   │
                └───┬──────────────┬───────────────┬──────────┘
                    │              │               │
             ┌──────▼─────┐  ┌─────▼──────┐  ┌─────▼────────┐
             │ Postgres   │  │ Object     │  │ Job worker   │
             │ structure  │  │ store      │  │ (arq/Celery) │
             │ notes      │  │ PDFs,      │  │              │
             │ artifacts  │  │ exports    │  │  ├ parse     │
             │ edges      │  └────────────┘  │  ├ distil    │◀── skills/
             └──────┬─────┘                  │  ├ embed     │    (versioned
                    │                        │  ├ concepts  │     prompt
                    │                        │  └ export    │     packages)
             ┌──────▼─────┐                  └──────┬───────┘
             │  Qdrant    │◀────────────────────────┘
             │  blocks    │        embeddings
             │  distills  │
             │  documents │
             └────────────┘
                    ▲
                    │  REST
        ┌───────────┴──────────────────────────────┐
        │  Astro shell + React islands             │
        │  library · reader · brief · search ·     │
        │  graph · review queue                    │
        └──────────────────────────────────────────┘
```

**Mapping to what exists today**: `backend/` already provides the app factory, settings,
guardrails, error envelope, and a `books` resource — that resource becomes `documents`.
`frontend/` is Astro; it stays Astro with React islands (§12). The Qdrant key in `.env` is for
the index in §10.

---

## 5. Architectural decisions

Each decision states the call, the reason, and what it costs.

| # | Decision | Rationale | Consequence |
|---|---|---|---|
| D1 | **Postgres is the only source of truth; Qdrant, exports, and artifacts are derived** | Lets you rewrite prompts and parsers without fear | Every derived store needs a rebuild job from day one |
| D2 | **Markdown is an export format, not the store** | Markdown files drift, lose anchors, and can't be queried | Reader renders from structured JSON, not from `.md` |
| D3 | **Parsing is ToC-driven, not page-driven** | Chapter/section boundaries are the unit humans think in, and the unit distillation needs | Documents without an outline need a heading-detection fallback plus a manual fix-up UI (§8) |
| D4 | **Blocks carry stable anchors and content hashes** | Anchors survive re-parsing; hashes make re-runs incremental | Anchor assignment must be deterministic, not row-id based |
| D5 | **Skills are versioned prompt packages executed as jobs** | Reproducible, diffable, cheap to re-run on one chapter | Needs a job table, an artifact-versioning scheme, and a review queue |
| D6 | **Every generated sentence cites block anchors** | Makes hallucination visible and the reader clickable | Skills must emit structured output, not prose (§9) |
| D7 | **Distillation is strictly bottom-up and rank-isolated** | Removes duplication by construction, not by a cleanup pass | A book-level dedup pass is still needed across chapters |
| D8 | **Retrieval resolves an address before it searches** | "Summarize chapter 3" is a lookup, not a similarity problem | Query router needs an intent step (§10) |
| D9 | **The graph is a derived edge table in Postgres, not a graph database** | At this corpus size, recursive CTEs over an indexed edge table are fast and free | Deep traversals (>3 hops) stay out of scope |
| D10 | **Astro shell + React islands, no framework rewrite** | The existing frontend already works; only three surfaces are genuinely interactive | Islands must own their own state; no global client store |
| D11 | **AI never edits your words** | Your notes are the one irreplaceable artifact | `note.raw` immutable; structured version is a separate derived row |
| D12 | **No quantization, single Qdrant node** | Hundreds of documents ≈ 10²–10⁵ vectors; quantization adds complexity and recall loss for nothing | Revisit past ~1M vectors |

---

## 6. Data model

Postgres. SQLite is fine for phase 0, but move before distillation lands: JSONB, array
containment, and full-text search all earn their keep in phase 1.

```sql
-- SOURCE ---------------------------------------------------------------
create table documents (
  id            uuid primary key,
  kind          text not null,              -- 'pdf' | 'article'
  slug          text not null unique,        -- 'meadows-systems'
  title         text not null,
  authors       text[] not null default '{}',
  year          int,
  source_uri    text,                        -- original URL, if any
  storage_key   text,                        -- object-store key of the original file
  sha256        text not null,               -- dedupe: same file never ingested twice
  page_count    int,
  language      text default 'en',
  status        text not null,               -- see §7 state machine
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now()
);

-- STRUCTURE ------------------------------------------------------------
-- One row per node of the document tree. Chapters and sections are the same
-- shape at different depths; blocks are the leaves.
create table nodes (
  id            uuid primary key,
  document_id   uuid not null references documents on delete cascade,
  parent_id     uuid references nodes on delete cascade,
  anchor        text not null,               -- 'ch03/s02/p014'  (stable, deterministic)
  kind          text not null,               -- part|chapter|section|paragraph|list|table|figure|quote
  ordinal       int  not null,               -- sibling order
  depth         int  not null,
  heading       text,                        -- set on part/chapter/section
  text          text,                        -- set on leaves
  content_hash  text,                        -- sha256 of normalized text; drives incremental re-runs
  page_from     int,
  page_to       int,
  meta          jsonb not null default '{}', -- table shape, figure caption, footnote refs
  unique (document_id, anchor)
);
create index on nodes (document_id, parent_id, ordinal);
create index on nodes (document_id, kind);

-- HUMAN ----------------------------------------------------------------
create table notes (
  id            uuid primary key,
  document_id   uuid not null references documents on delete cascade,
  anchor        text not null,               -- what it is attached to
  range         jsonb,                       -- {start,end} char offsets for highlights
  raw           text not null,               -- YOUR WORDS. never rewritten (D11)
  color         text,                        -- highlight tone
  created_at    timestamptz not null default now()
);

-- DISTILLATION ---------------------------------------------------------
-- Every AI output lands here. Immutable and versioned: a re-run inserts a new
-- version, the old one stays for diffing.
create table artifacts (
  id            uuid primary key,
  document_id   uuid not null references documents on delete cascade,
  anchor        text,                        -- scope: null = whole document
  type          text not null,               -- section_note|chapter_distillation|book_brief
                                             -- |structured_note|quote_set|quiz|flashcards
  version       int  not null,
  skill         text not null,               -- 'distil-chapter'
  skill_version text not null,               -- '3'
  model         text not null,               -- 'claude-opus-5'
  input_hash    text not null,               -- hash of the exact inputs; makes re-runs idempotent
  body          jsonb not null,              -- render-contract blocks (§9)
  citations     text[] not null default '{}', -- every anchor referenced by body
  review        text not null default 'draft', -- draft|approved|rejected
  created_at    timestamptz not null default now(),
  unique (document_id, anchor, type, version)
);
create index on artifacts (document_id, type, review);
create unique index on artifacts (type, input_hash, skill_version)
  where review <> 'rejected';                -- never pay twice for the same input

-- CONNECTION -----------------------------------------------------------
create table concepts (
  id            uuid primary key,
  canonical     text not null unique,        -- 'feedback loop'
  aliases       text[] not null default '{}',
  kind          text not null,               -- concept|framework|person|work|term
  blurb         text,                        -- one sentence, itself cited
  created_at    timestamptz not null default now()
);

create table edges (
  id            uuid primary key,
  src_kind      text not null,               -- 'node' | 'concept' | 'artifact'
  src_id        text not null,               -- uuid, or document_id#anchor for nodes
  dst_kind      text not null,
  dst_id        text not null,
  relation      text not null,               -- mentions|defines|supports|contradicts
                                             -- |extends|example_of|same_as
  weight        real not null default 1.0,
  evidence      text[] not null default '{}', -- anchors backing the claim
  origin        text not null,               -- 'skill:link-concepts@2' | 'human'
  created_at    timestamptz not null default now(),
  unique (src_kind, src_id, dst_kind, dst_id, relation)
);
create index on edges (dst_kind, dst_id, relation);
create index on edges (src_kind, src_id, relation);

-- ORCHESTRATION --------------------------------------------------------
create table jobs (
  id            uuid primary key,
  kind          text not null,               -- parse|distil_section|distil_chapter|brief
                                             -- |embed|link_concepts|export
  document_id   uuid references documents on delete cascade,
  anchor        text,
  skill         text,
  skill_version text,
  input_hash    text,
  state         text not null,               -- queued|running|done|failed|skipped
  attempts      int not null default 0,
  error         text,
  cost_tokens   int,
  duration_ms   int,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index on jobs (state, kind);
```

Two things worth noticing: `artifacts` is append-only with a uniqueness guard on
`(type, input_hash, skill_version)`, so an unchanged chapter is never re-distilled; and `edges`
is polymorphic by `(kind, id)` pairs, so the graph can link a block to a concept to a
distillation without three separate tables.

---

## 7. Pipeline

One state machine per document. Each transition is a job; jobs are idempotent and keyed by
`input_hash`, so re-running any stage on unchanged input is a no-op.

```
 uploaded ──▶ parsing ──▶ parsed ──▶ distilling ──▶ distilled ──▶ indexed ──▶ linked
     │            │           │           │              │
     │            └─▶ parse_failed        └─▶ needs_review (low grounding score, §14)
     └─▶ duplicate (sha256 already present)
```

| Stage | Job | Input | Output | Human touchpoint |
|---|---|---|---|---|
| 1 | `parse` | original file | `nodes` tree | fix chapter boundaries if the outline was guessed |
| 2 | `distil_section` | one section's blocks | `section_note` artifact | — |
| 3 | `distil_chapter` | that chapter's section notes | `chapter_distillation` | review & approve |
| 4 | `brief` | all chapter distillations | `book_brief` (+ cross-chapter dedup) | review & approve |
| 5 | `embed` | blocks + approved artifacts | Qdrant points | — |
| 6 | `link_concepts` | approved artifacts | `concepts` + `edges` | merge duplicate concepts |
| 7 | `export` | tree + approved artifacts | Markdown bundle | — |

Stage 3 and 4 only ever consume **approved** output from the stage below when a human has
reviewed it; otherwise they consume drafts and mark their own output `draft` too. Approval
propagates upward, so a corrected section note invalidates the chapter distillation above it
(same `input_hash` mechanism, new hash → re-run).

### The skill contract

A skill is a directory in the repo, not a prompt buried in Python:

```
skills/
  distil-chapter/
    SKILL.md          # the prompt: role, method, hard rules, few-shot
    schema.json       # JSON Schema the output must satisfy
    meta.yaml         # version, model, max_tokens, inputs selector
```

The runner: select inputs → hash them → check `artifacts` for a hit → render prompt → call the
model → validate against `schema.json` → compute the grounding score (§14) → insert artifact as
`draft`. A prompt change means a version bump, which changes `input_hash`, which queues re-runs
of exactly the affected scopes. Prompt iteration becomes a reviewable diff with a measurable
effect.

Initial skill set — one artifact type each, deliberately small:

`parse-outline` · `distil-section` · `distil-chapter` · `write-brief` · `structure-note` ·
`link-concepts`. Phase 4 adds `extract-quotes` · `make-quiz` · `make-flashcards`.

---

## 8. Parsing: a three-tier ladder

The single hardest part, and the one most likely to be over-engineered. Rule: use the cheapest
tier that produces a usable tree, and let the human fix the rest.

| Tier | Tool | When | Output quality |
|---|---|---|---|
| 1 | PyMuPDF: embedded outline + text blocks with coordinates | PDF has a ToC and a text layer — most real books | Good. Chapters exact, sections exact |
| 2 | Tier 1 minus outline: heading detection from font-size/weight clustering, then ToC-page parsing | Text layer but no outline | Decent. Chapter boundaries usually right, sections sometimes merged |
| 3 | OCR (`ocrmypdf`/Tesseract), then tier 2; vision model per page only where layout is broken | Scanned books, heavy multi-column, tables as images | Acceptable. Always lands in `needs_review` |

Decision rule, applied automatically at ingest:

```
text_chars_per_page < 200          → tier 3 (scanned)
has embedded outline               → tier 1
else                               → tier 2
```

Cross-tier rules that matter more than the tier choice:

- **Reading order before prose.** Multi-column pages get sorted by column, not by y-coordinate,
  or every downstream stage inherits scrambled text.
- **Strip the furniture.** Repeated headers, footers, and page numbers are detected by
  cross-page repetition and dropped before hashing.
- **Keep tables as tables.** A table becomes one block with `meta.table = {header, rows}`, never
  flattened prose.
- **Footnotes are attached, not inlined.** `meta.footnotes` on the owning block.
- **Manual fix-up is a first-class feature, not an admission of failure.** A small editor to
  merge/split/rename chapters, saved as an outline override that survives re-parsing.

Articles (HTML) go through the same interface: Readability-style extraction, `h1..h3` as the
tree, treated as a single-chapter document. Same blocks, same anchors, same distillation.

---

## 9. Distillation

The part that decides whether the system is worth using.

### Hierarchical, bottom-up, rank-isolated

`section_note` reads only its own blocks. `chapter_distillation` reads only its own section
notes. `book_brief` reads only the chapter distillations. No stage sees its siblings, so no stage
can repeat them — deduplication is structural (D7). The one exception is `write-brief`, which
*does* see all chapters at once and is explicitly tasked with collapsing repeated ideas and
noting where the author circles back.

### Output is structured, not prose

Skills emit a small, closed set of render blocks. This is what makes "tables, bullets, callouts,
highlights" reliable instead of a markdown lottery, and what lets the frontend style everything
consistently:

```jsonc
{
  "blocks": [
    { "type": "heading", "level": 2, "text": "Leverage points" },
    { "type": "paragraph",
      "spans": [ { "text": "Rules outrank parameters.", "cites": ["ch06/s01/p003"] } ] },
    { "type": "callout", "tone": "insight",
      "spans": [ { "text": "Most interventions fail at the weakest leverage point.",
                   "cites": ["ch06/s02/p011"] } ] },
    { "type": "table",
      "header": ["Leverage point", "Power", "Example"],
      "rows": [ [ { "text": "Paradigms", "cites": ["ch06/s09/p002"] }, … ] ] },
    { "type": "quote", "text": "…", "cites": ["ch02/s01/p007"], "page": 34 },
    { "type": "definition", "term": "stock", "spans": [ … ] }
  ]
}
```

Closed block set: `heading` · `paragraph` · `bullets` · `steps` · `table` · `callout`
(`insight|caution|contrast|question`) · `quote` · `definition`. Nothing else. Adding a ninth
type is a deliberate change to the render contract and the frontend, in the same commit.

**Every leaf span carries `cites`.** A distillation with uncited claims fails validation (§14).

### Your notes

`structure-note` takes `note.raw` and emits a `structured_note` artifact in the same render
contract — tidied, tagged, linked to concepts, and cited back to the passage you highlighted.
The raw text is never touched and stays visible next to the structured version (D11).

### Format of a brief

One page, fixed shape, so briefs are comparable across books: *thesis in three sentences ·
five to seven load-bearing ideas · the argument's structure · what it changes about how you act ·
where it is weak or dated · read-next pointers into your own shelf*. That last section is the
one only this system can write.

---

## 10. Retrieval

### Address before search (D8)

A router classifies each query first:

| Intent | Example | Resolution |
|---|---|---|
| **Addressed** | "summarize chapter 3 of Meadows" | Deterministic tree fetch. No vectors involved |
| **Discovery** | "what do I know about feedback loops?" | Tier-1 search over distillations, then evidence blocks |
| **Synthesis** | "how do Meadows and Senge disagree?" | Multi-document distillation retrieval + `contradicts` edges |
| **Lexical** | "find the exact phrase 'stock and flow'" | Sparse/BM25 only |

Classification is a cheap, cached call with a hard fallback to Discovery. The point is that the
two most common questions — "remind me what this chapter said" and "find the exact wording" —
never touch an embedding model.

### Two-tier hybrid search

Search the **distillation** collection to decide *what* is relevant; search the **blocks**
collection to fetch *evidence* for the chosen scopes. Answers are assembled from dense
distillation prose plus a handful of cited source passages — far less context, far better
answers than top-k over raw chunks.

### Qdrant layout

Three collections. Named vectors must be declared at creation time — changing them later means a
rebuild, which is fine (D1) but worth avoiding:

```
blocks          dense: "text" (bge-small-en-v1.5, 384d, cosine)
                sparse: "bm25"
                payload: document_id, anchor, chapter_no, section_path,
                         kind, tags[], char_len, model_id

distillations   same vector config
                payload: document_id, anchor, type, level, tags[], review, model_id

documents       metadata only, point id = document_id — the join target for `with_lookup`
```

Grounded in the current Qdrant guidance:

- **Payload indexes are created immediately after the collection, before bulk upsert**, so they
  build alongside HNSW: `document_id` (keyword), `chapter_no` (integer), `tags` (keyword),
  `type`/`level`/`review` (keyword).
- **BM25 `avg_len` is tuned per collection.** Blocks are document-length; distillation bodies are
  shorter. Leaving the default on the short collection skews scoring.
- **Grouping by `document_id` with `with_lookup` into `documents`** keeps document metadata in
  one place instead of copying the title onto every point, and stops one verbose book from
  taking every slot in the results.
- **Prefetch sizing**: `prefetch_limit ≥ final_limit × expected_chunks_per_document`, or relevant
  documents drop out during grouping.
- **`model_id` on every point**, so a model swap is detectable and re-embedding is a filtered job
  rather than a full wipe.
- **No quantization** at this corpus size (D12).

Reranking sits above both tiers as a single cross-encoder pass over the merged candidate set —
cheap, and it matters more than any amount of embedding tuning.

Docs relied on: [multi-representation search](https://qdrant.tech/documentation/tutorials-search-engineering/multi-representation-search/) ·
[search groups & lookup](https://qdrant.tech/documentation/concepts/search/) ·
[full-text search](https://qdrant.tech/documentation/concepts/indexing/)

---

## 11. The idea graph

Ambitious in the idea dump ("a big net"); the scoped version is **neighborhoods, not nets**.

**Nodes**: concepts, blocks, artifacts, documents. **Edges**: the seven relations in §6.
`link-concepts` runs over approved distillations, proposes concepts and edges with evidence
anchors, and every edge records its origin so machine proposals and human curation stay
distinguishable.

**Concept deduplication** — the failure mode that turns a graph into noise: candidate merges come
from embedding similarity above a threshold plus an LLM confirmation, and then land in the review
queue as a proposed `same_as` edge. Merges are applied by a human, never automatically.

**Navigation rules**, which exist to keep the thing usable:

- One focal node at a time; depth ≤ 2; at most 150 nodes rendered.
- Edges ranked by weight × evidence count; the long tail is collapsed behind "show more".
- Every edge in the UI is clickable through to its evidence passages. An edge you can't verify
  is a liability.
- No global "show me everything" view. It looks impressive in a screenshot and is useless in
  practice.

Queries are recursive CTEs over the indexed `edges` table (D9).

---

## 12. Frontend

Keep Astro as the shell and routing layer; add React islands only where interaction is real
(D10). Six surfaces:

| Surface | Tech | Why |
|---|---|---|
| **Library** | Astro, static | Shelf grid, filters, ingest status. No client state worth shipping JS for |
| **Reader** | React island | Two panes — source blocks left, distillation right — anchor-synced scrolling, highlight/note creation. Genuinely interactive |
| **Brief** | Astro, static | Renders one approved artifact. Server-rendered, instant, printable |
| **Search** | React island | Query box, intent badge, grouped results, cited answer with click-through |
| **Graph** | React island | Canvas force layout over a neighborhood endpoint, node cap enforced client-side |
| **Review queue** | React island | Draft artifacts, diff against the previous version, approve / edit / reject / re-run |

The render contract (§9) is implemented once as a `<Blocks>` component and reused by reader,
brief, search results, and notes. Highlight colors, callout tones, and table styling live there
and nowhere else.

**The review queue is not optional.** It is the difference between a knowledge base you trust and
a pile of plausible AI text. It ships in phase 1, with the first distillation.

---

## 13. API surface

```
POST   /documents                      ingest (multipart PDF | {url})   → 202 + job
GET    /documents                      list, filter by tag/status/author
GET    /documents/{id}                 metadata + pipeline state
GET    /documents/{id}/tree            outline; ?depth=, ?include=blocks
PATCH  /documents/{id}/outline         manual chapter/section fix-up
GET    /documents/{id}/blocks          paginated, ?anchor_prefix=

GET    /nodes/{document_id}/{anchor}   one block or subtree

POST   /notes                          create highlight/note
GET    /notes?document_id=&anchor=

GET    /artifacts?document_id=&type=&review=
POST   /artifacts/{id}/review          approve | reject | edit
POST   /jobs                           enqueue {kind, document_id, anchor?, force?}
GET    /jobs?state=&kind=              queue view for the review UI

POST   /search                         {query, mode?, filters?}  → grouped, cited results
GET    /concepts?q=                    typeahead
GET    /graph/neighborhood?node=&depth=
GET    /exports/{document_id}.md       Markdown bundle
```

All of it sits behind the existing `/api/v1` prefix, error envelope, and API-key guard on writes.
Ingest and job endpoints return `202` with a job id; the frontend polls `/jobs`.

---

## 14. Quality gates

The guardrails that matter here are about **truthfulness of generated content**, layered on top
of the transport-level guardrails already in `backend/`.

| Gate | Mechanism | On failure |
|---|---|---|
| **Schema** | Output validated against the skill's `schema.json` | Retry once, then `failed` |
| **Grounding** | Share of leaf spans carrying ≥1 valid `cites` anchor | < 0.9 → `needs_review` |
| **Anchor validity** | Every cited anchor exists in this document | Reject, re-run |
| **Compression** | Distillation length vs. source length within expected band | Outside → flag (too long = copying, too short = skipping) |
| **Duplication** | Similarity between sibling distillations | Above threshold → flag for the brief's dedup pass |
| **Cost ceiling** | Per-document token budget, tracked in `jobs` | Pause the document, surface in the queue |
| **Idempotency** | `(type, input_hash, skill_version)` unique | Skip; never pay twice |

Grounding score is the important one: it turns "does the AI make things up?" from a vibe into a
number you can watch across prompt versions.

---

## 15. Phases

Each phase ends with something usable on its own.

**Phase 0 — Shelf & reader** *(no AI at all)*
Ingest a PDF, parse tiers 1–2, browse the tree, read blocks in the reader, highlight, write raw
notes, export Markdown. Rename `books` → `documents`, add `nodes` and `notes`, move to Postgres.
*Done when*: you can drop in a PDF and read it in the app with your highlights.

**Phase 1 — Distillation**
Job runner, skill loader, `distil-section` → `distil-chapter` → `write-brief`,
`structure-note`, render contract, review queue, grounding score.
*Done when*: a book yields chapter distillations and a one-page brief you'd actually reread.

**Phase 2 — Retrieval**
Embeddings, the three Qdrant collections, intent router, two-tier hybrid search, reranking,
cited answers.
*Done when*: "what do I know about X" returns a cited answer across books.

**Phase 3 — Graph**
`link-concepts`, concept dedup with human merge, neighborhood endpoint and view.
*Done when*: you can start at a concept and walk to passages in three different books.

**Phase 4 — Generated artifacts** *(optional, cheap once 1–3 exist)*
`extract-quotes`, `make-quiz`, `make-flashcards`, spaced-repetition review. Same skill runner,
same review queue, same citations. No new architecture.

---

## 16. Open questions

| # | Question | Recommendation |
|---|---|---|
| 1 | Postgres now or at phase 1? | At phase 1. SQLite is fine while there is no JSONB, array, or FTS work |
| 2 | Which embedding model? | `bge-small-en-v1.5` via FastEmbed locally — free, fast, good enough at this scale. `model_id` on every point makes a later swap a filtered re-embed |
| 3 | Job queue? | `arq` on Redis. Celery is heavier than this workload deserves |
| 4 | Distillation model? | Opus for `write-brief` and `link-concepts`; Sonnet for section notes. Recorded per artifact, so the trade-off is measurable |
| 5 | Where do exports live? | Object store, regenerated on approval. Never read back as input (D2) |
| 6 | Multi-language books? | Defer. Record `language`, keep BM25 tokenization configurable, do nothing else until a non-English book actually arrives |
| 7 | Figures and diagrams? | Phase 0 keeps them as image blocks with captions. Vision-model description is a phase 4 skill |

---

## 17. Risks

| Risk | Mitigation |
|---|---|
| Parsing quality caps everything downstream | Tier ladder plus a manual fix-up UI; treat `needs_review` as normal, not as failure |
| Distillations that read well but say nothing | Grounding score, compression band, and a human approval step before anything is indexed |
| Concept graph degenerates into noise | Human-confirmed merges only; evidence required on every edge; neighborhoods, not a global net |
| Scope creep into video/quiz/extras before the core works | Phases 0–3 are the product; phase 4 is explicitly optional (§1) |
| Prompt drift making old artifacts incomparable | Skill versions on every artifact; re-runs are diffs, not overwrites |
