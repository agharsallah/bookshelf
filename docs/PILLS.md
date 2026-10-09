# Pills — Design

**Status**: built · **Date**: 2026-10-06 · **Owner**: agharsallah

A vertical, swipeable feed of **learning pills**: one idea each, 15–60 seconds, cited, one tap
from the passage it rests on. Reels for the shelf, built for remembering rather than for
time spent.

Pills reuse what the pipeline already wrote. Most are **harvested** from approved (or
preferred draft) artifacts by pure Python at zero tokens; one new skill, `make-pills`,
**composes** hooks and threads, and only runs lazily, per chapter, when a feed runs low.
Nothing is generated when a book is added.

The web feed is the first client. The contract (`contracts/pill.schema.json`), the API and
the framework-free client core (`frontend/src/lib/pills/`) are built so a mobile app can be
added later without backend changes (§8).

---

## 1. Decisions

| # | Decision | Why | Cost |
|---|---|---|---|
| L1 | **Harvest before compose** | Flashcards, quizzes, quotes, callouts, definitions, numbers, figures, claims, math, graph links and narration already exist and are cited | One harvester per source type; pills are only as good as their artifacts |
| L2 | **`pills` is derived and rebuildable (D1)**; events, saves and sessions are human data | Same rule as the rest of the shelf | A rebuild retires and recreates rows; events keep pointing at retired pills (`retired_at`, never deleted while referenced) |
| L3 | **`make-pills` is lazy and budgeted** | No tokens spent on books nobody scrolls | Low-water top-up + explicit button + daily cap in `app_settings` |
| L4 | **One closed set of pill kinds** (§2) | Like render blocks: reliable rendering on every client | Adding a kind changes the schema, backend and frontend renderers in the same commit |
| L5 | **The feed is a ranked query, not a stored list**: deterministic, seeded, no LLM | Reproducible sessions, testable ranking | Learning signals are coarse (kind affinity, concept exposure) |
| L6 | **Finite sessions by default** (10 · 20 · 40; endless is opt-in) | A session ends on a summary, not on exhaustion | — |
| L7 | **Saves and misses join the existing FSRS queue** (`review_items`, source `pill`) | One review system; Today's "Due today" picks them up | — |
| L8 | **Self-contained pill payloads + idempotent, batched events** | A client renders a page with no extra calls and can queue events offline | Payloads are larger than ids |

---

## 2. The pill contract

`contracts/pill.schema.json` is the truth; Pydantic models (`app/pills/contract.py`) and TS
types (`frontend/src/lib/pills/types.ts`) mirror it and are tested against its fixtures.
Spans and cites are the render contract's (`render-blocks.schema.json#/$defs/span`).

```jsonc
{
  "id": "uuid",
  "kind": "insight",                  // §2 table
  "document": { "id": "uuid", "slug": "meadows-systems", "title": "Thinking in Systems",
                "genre": "book", "theme": "Systems" },   // theme: catalogue theme name or null
  "anchor": "ch06",                   // the unit (chapter/section) the pill belongs to
  "unit_title": "Leverage Points",    // or null
  "headline": "Rules beat knobs",     // short hook line (≤ 80 chars) or null
  "body": { /* kind-specific, below */ },
  "cites": ["ch06/s01/p003"],         // every anchor the pill rests on; `<slug>:<anchor>` when cross-document
  "sources": { "<cite>": { "document": { "id", "slug", "title" }, "anchor": "…" } },
  "concepts": ["leverage point"],
  "thread": { "key": "…", "index": 0, "size": 4, "title": "…" },   // or null
  "est_seconds": 20,
  "origin": "harvest:flashcards",     // or "skill:make-pills@1"
  "draft": false,                     // source artifact not yet approved
  "review_item_id": null              // set on `review` pills
}
```

| Kind | Body | Harvested from |
|---|---|---|
| `insight` | `{spans, why?: spans}` | `important` · `insight` callouts; salience `core` marks |
| `remember` | `{spans}` | `remember` callouts |
| `antipattern` | `{spans}` | `antipattern` callouts |
| `quote` | `{text, page?: int}` | `quote_set` |
| `definition` | `{term, spans}` | `definition` blocks; `glossary` |
| `number` | `{value, label: spans}` | `book_guide.numbers`, `paper_card.numbers` |
| `figure` | `{image_url, caption?, takeaway: spans}` | `figure_description` + the figure node's crop |
| `diagram` | `{diagram: <render diagram block>, caption?}` | `diagram` blocks in distillations and guides |
| `quiz` | `{question, choices: [str], answer: int, explanation: spans}` | `quiz` |
| `flip` | `{front, back: spans}` | `flashcards` |
| `claim` | `{text, claim_kind, strength, support: {supports, contradicts, extends}}` | `claims` (+ accepted claim edges) |
| `math` | `{latex, name, plain: spans, try_it?: {question, answer}}` | `math_explainer.formulas` |
| `connection` | `{relation, concept?, sides: [{document, anchor, spans}] (2)}` | accepted graph edges with evidence (echoes, bridges, concept edges across documents) |
| `listen` | `{audio_url, start_ms, end_ms, transcript: spans}` | audio summary manifests (turn timings) |
| `hook` | `{spans, payoff: spans}` | `make-pills` only |
| `review` | `{prompt, answer: spans}` | a due `review_item`, synthesized at feed time (never stored in `pills`) |

`est_seconds` = words ÷ 238 wpm × 60, clamped to [8, 90]; active kinds (`quiz`, `flip`, `review`) add 10 s.
**Active kinds**: `quiz`, `flip`, `review`, and `math` with `try_it`.

---

## 3. Data model

Migration `supabase/migrations/<ts>_pills.sql` (local first; see the migration-version rule in
CLAUDE memory before any remote apply).

```sql
create table pills (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references documents(id) on delete cascade,
  anchor             text not null,          -- unit anchor
  kind               text not null,          -- check constraint: §2 kinds except 'review'
  headline           text,
  body               jsonb not null,
  cites              text[] not null default '{}',
  concepts           text[] not null default '{}',
  thread_key         text, thread_index int, thread_title text,
  est_seconds        int not null,
  origin             text not null,          -- 'harvest:<artifact_type>' | 'skill:make-pills@<v>'
  source_artifact_id uuid references artifacts(id) on delete set null,
  source_key         text not null,          -- stable: sha256(origin-type, document, anchor, normalized content)
  draft              boolean not null default false,
  created_at         timestamptz not null default now(),
  retired_at         timestamptz,
  unique (source_key)
);
create table pill_sessions (
  id uuid primary key default gen_random_uuid(),
  config jsonb not null, seed bigint not null,
  served uuid[] not null default '{}',      -- pill ids in order (review pills: their item id)
  position int not null default 0,
  created_at timestamptz not null default now(), finished_at timestamptz
);
create table pill_events (
  id uuid primary key,                       -- client-generated: retries are no-ops
  session_id uuid references pill_sessions(id) on delete set null,
  pill_id uuid references pills(id) on delete cascade,
  review_item_id uuid references review_items(id) on delete cascade,
  kind text not null,  -- seen · dwell · answer · save · unsave · skip · too_easy · confusing · open_source
  value jsonb,         -- dwell: {ms}; answer: {correct: bool, choice?}
  at timestamptz not null
);
create table feeds (
  id uuid primary key default gen_random_uuid(),
  name text not null, config jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
```

Plus: `artifact_type` gains `pill_set`; `review_source` gains `pill`; job kind `harvest_pills`;
activity `surface` gains `pills` (whatever form each enum takes in the schema).

---

## 4. Harvest

`app/pills/harvest/`: one module per source, registered by artifact type
(`HARVESTERS: dict[ArtifactType, Harvester]`), each a **pure function**
`(HarvestInput) -> list[PillDraft]` over an artifact body plus the little context it needs
(document, unit titles, figure media paths). Rules:

- Read each document's **preferred** artifact per `(type, anchor, variant)`: latest approved,
  else latest non-rejected draft (`draft = true` on its pills).
- One idea per pill: split multi-part items; skip spans under 6 words or over 80 words.
- Connection pills come from the graph tables (accepted edges whose evidence spans two
  documents), listen pills from audio manifests on disk; both are harvesters too.
- `harvest_pills` job (per document, idempotent): compute the desired set, upsert by
  `source_key`, retire rows no longer produced (unretire if they come back).
- Queued after any artifact of a harvestable type is stored or reviewed (the derive handler
  and `orchestrator.on_review`, auto-approval included), after `pill_set` materialization,
  and by `POST /pills/rebuild` (one document or all: the backfill).

---

## 5. `make-pills` (the one new skill)

```yaml
name: make-pills
version: 1
tier: explore              # rewrites already-cited distillation; promote to distil if gates show it
job_kind: derive
artifact_type: pill_set    # materialized into `pills` (origin skill:make-pills@1), like claim_set → claims
scope: chapter
selector: chapter_pills    # chapter distillation + salience marks + headlines/keys of pills already harvested
params:
  style: { choices: [plain, story, socratic], default: plain }
variant: "{style}"
gates:
  grounding_min: 0.9
  pill_words: [8, 60]      # new gate: words per pill body
```

Output: `{threads: [{title, pills: [...]}], pills: [...]}` where each pill is `{kind ∈ hook ·
insight · remember · antipattern · definition · quiz · flip, headline, body, cites}`. It writes
what harvesting cannot: **hooks** (why care, then the payoff), **threads** (3–6 pills that tell
a chapter's arc in order), and headlines. It must not restate a harvested pill (the selector
passes their keys and headlines; a check refuses near-duplicates by normalized text).

**When it runs** (`app/pills/generate.py`):
- `top_up(session, config, unseen)`: when a session's unseen supply drops under **30** and
  `app_settings.pills.auto_generate` is on, queue `make-pills` for up to 2 chapters in scope
  that have a chapter distillation and no `pill_set`, ordered: chapter in progress, next
  unread, the rest in reading order. Never above `pills.max_chapters_per_day` (default 4).
- `POST /pills/generate {document, anchors?, style?}` queues explicitly (still deduped by
  `input_hash`), returning a token estimate from `model_runs` averages for the skill.
- A book with no distillations yields no pills; the API says so (`supply.undistilled`)
  instead of queuing the distillation chain.

---

## 6. Feed

`app/pills/feed/`: pure functions, a seeded RNG, no LLM.

```jsonc
// FeedConfig
{ "sources": { "documents": [], "collections": [], "paper_sets": [], "concepts": [],
               "genre": null },          // all empty = the whole shelf
  "mode": "consolidate",                 // consolidate · preview · explore · review
  "kinds": null,                         // null = all
  "length": 20,                          // 10 · 20 · 40 · null (endless)
  "spoilers": false }
```

- **Scope**: documents from `documents` ∪ members of `collections` ∪ `paper_sets` ∪ documents
  citing `concepts`; pills whose `concepts` overlap when concepts are given; archived
  documents excluded.
- **Modes**: *consolidate* = units read (before the saved reading position, or document
  finished; falls back to explore with `notice: "nothing read yet"`), *preview* = the next
  unread units, active kinds only, *explore* = everything (honours `spoilers`), *review* =
  due `review_items` in scope only.
- **Score** = `scope_match × novelty × (1 + kind_affinity) × spacing × draft_penalty`:
  novelty drops for pills seen (0.15) and their source unit seen this session; `kind_affinity`
  ∈ [-0.5, 0.5] from the last 30 days of dwell, skip, save, too_easy, confusing per kind;
  confusing ≥ 2 sinks a pill.
- **Mixer**: target ~60 % new from units in progress, 20 % due reviews, 10 % connections,
  10 % shelf serendipity (explore only); at least every 4th pill active; no two consecutive
  pills from the same unit unless they are one thread; threads stay together and in order.
- **Sessions** persist `config`, `seed`, `served`, so a session resumes on any client.

Signals: `save` (and a wrong `answer` on quiz or flip) upserts a `review_item` (source `pill`,
`source_key` = the pill's), prompt from the pill (front, question, headline or the first
span), answer its spans, due now. `unsave` deletes an unreviewed one. Answering a `review`
pill rates the item through the existing review path. Three `confusing` on pills of one
`pill_set` set that artifact to `needs_review`.

---

## 7. API

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/pills/sessions` | `{config}` or `{feed_id}` | `{session, page: {pills, next_cursor}, supply}` |
| GET | `/pills/sessions/{id}` | `?cursor=&limit=10` | `{pills, next_cursor, supply, done}` (`done` when `length` reached) |
| POST | `/pills/sessions/{id}/finish` | — | `{summary: {seen, saved, answered, correct, due_tomorrow, minutes, next_read?}}` |
| POST | `/pills/events` | `{events: [{id, session_id?, pill_id?, review_item_id?, kind, value?, at}]}` (≤ 200) | `{accepted, duplicates, ignored}` |
| GET | `/pills/supply` | config as query (`config=<json>`) | `{unseen, by_document: [{document, unseen, generatable: [{anchor, title, estimate_tokens}], undistilled}], low}` |
| POST | `/pills/generate` | `{document, anchors?, style?}` | `{jobs: [id], estimate_tokens}` |
| POST | `/pills/rebuild` | `{document?}` | `{jobs: [id]}` |
| GET | `/pills/{id}` | — | one pill |
| GET/POST | `/pills/feeds` | `FeedCreate {name, config}` | `{items}` / the saved feed |
| PATCH/DELETE | `/pills/feeds/{id}` | | |

`next_cursor` is opaque (the position in `served`). Errors use the app's error envelope.

---

## 8. Clients and mobile readiness

```
frontend/src/lib/pills/          framework-free TypeScript (no React, no DOM, no Astro)
  types.ts                       mirrors contracts/pill.schema.json
  client.ts                      createPillsClient({ baseUrl, fetch, headers }) — every endpoint in §7
  session.ts                     feed session state machine: load, advance, thread step, finish
  buffer.ts                      prefetch: keep ≥ 5 pills ahead, one request in flight
  events.ts                      batched, idempotent event queue over a StorageAdapter
  storage.ts                     StorageAdapter interface + memory + localStorage adapters
  config.ts                      FeedConfig defaults, URL (de)serialization for presets
frontend/src/components/pills/   React views over lib/pills (web only)
```

A mobile app (Expo/React Native) would reuse `lib/pills` as-is (moved to a pnpm workspace
package when that day comes), give it an AsyncStorage `StorageAdapter`, and write native
views per kind. Auth beyond the single API key is out of scope until then.

## 9. Web UX

- **`/pills`**: full-height vertical feed, `scroll-snap-type: y mandatory`, one pill per
  screen on phones; a centred tall column with an action rail on desktop. Story-style
  segmented progress at top. Keys: `j`/`↓`/space next, `k`/`↑` previous, `←`/`→` within a
  thread, `s` save, `o` open source, `?` confusing, `e` too easy, `Esc` end session.
- **Pill anatomy**: source chip (document spine colour by theme, unit title, kind badge),
  headline, one idea in large type, cite chip that opens the passage drawer (the guide's),
  rail: Save · Read (reader at anchor) · More (thread / same concept) · Huh / Too easy.
  Kind treatments: quote in serif, number huge, figure crop magnifiable, quiz answered in
  place with cited explanation, flip taps to turn, connection split in two, listen a clip
  that never autoplays, diagram via the existing Mermaid block.
- **Config sheet**: sources (books, papers, collections, concepts), mode, kinds, length,
  spoilers; save as a feed; saved feeds as chips.
- **End card**: seen, saved, correct/answered, due tomorrow, minutes, "Continue reading".
- **Supply** (workshop mode only): unseen per document, "Make pills" per chapter with the
  token estimate, undistilled books named.
- **Entry points** (presets via query: `?document=`, `?collection=`, `?concept=`,
  `?paper_set=`, `?mode=`, `?length=`): Today card ("5-minute pills"), document page,
  collection page, paper set page, concept page, nav item "Pills".
- Accessibility: each pill an `<article>`, everything by keyboard, `prefers-reduced-motion`
  turns off smooth snapping, no autoplay; design tokens and dark mode from `base.css`.
- Time spent counts as activity surface `pills` in reader statistics.

## 10. Module layout

```
backend/app/pills/
  contract.py  store.py  harvest/{__init__,callouts,study,quotes,guide,figures,papers,graph,audio,…}.py
  feed/{config,scope,rank,mixer,sessions}.py  events.py  reviews.py  supply.py  generate.py
backend/app/pipeline/handlers/pills.py   harvest_pills job, pill_set materialization
backend/app/api/routes/pills.py          §7
skills/make-pills/                       SKILL.md · schema.json · meta.yaml · example.json
contracts/pill.schema.json
frontend/src/lib/pills/  frontend/src/components/pills/  frontend/src/pages/pills/
```

## 11. Implementation notes

Where the code departs from, or makes precise, the text above.

### Contract and harvest (§2, §4)

- `quote` bodies also carry `attribution?` (the quote set has it). Review pills, built at
  feed time, use origin `review:<source>`; connection pills `harvest:graph`.
- `math.try_it.question` is plain text (the skill writes spans; they are joined).
- Connection sides cite anchors of *their own* document inside `spans`; the pill's top-level
  `cites` use `<slug>:<anchor>` for the other side. `sources` holds every resolvable cite.
- `concepts`: names of the concepts whose accepted edges rest on a cited passage (or below
  a cited container), plus a definition's term or a connection's concept; at most 6.
- Callouts are harvested from chapter distillations (books and paper units); the guide
  gives numbers and diagrams. The same idea from two sources is kept once (`HARVESTERS`
  order). Prose word bounds (6–80) apply to callouts, marks, quotes, definitions, claims and
  listen turns; not to quiz, flip, number, math, diagram, figure or `pill_set` pills.
- Front matter (a chapter with `meta.front_matter`: title, copyright and cover pages) is no
  unit, so it gives no pills.
- Connection sides are clipped to 40 words (two must fit a phone), and a side that is not
  prose (a bibliography entry, an author list or a results-table row the parser left in the
  text: `harvest.graph.is_prose`) drops the connection. Each document holds its own view of
  an edge (its side first); a feed scope covering both documents serves one of the two
  (`feed.candidates.one_per_edge`).
- `harvest_pills` is also queued after a `narrate` job (renders make listen pills). The
  orchestrator's entry points queue it beside the pipeline and leave it out of their
  return values. Graph changes do not queue it yet: `POST /pills/rebuild` refreshes
  connections.

### make-pills (§5)

Modules: `app/pills/skill_inputs.py` (the selector), `checks.py`, `generatable.py` (which
chapters are open, ranked) and `generate.py` (`top_up`, `enqueue`, `estimate_tokens`;
exports `SKILL` and `LOW_WATER`).

- `chapter_pills` (`app/pills/skill_inputs.py`): `distillation` (required), `salience` (core
  and key marks only, without their `why`), `harvested: [{kind, text, key}]` — `text` the
  headline or the first 12 words, `key` a 12-character prefix of `source_key` (the full
  hash costs tokens and the model has no use for it), at most 60. make-pills' own pills are
  left out, so a run's output never changes the next run's input.
- `pill_words` is a soft gate (flags `pill_too_short` / `pill_too_long`, so the artifact lands
  in `needs_review`; its pills are still harvested as drafts). It counts every word a body
  reads (`pipeline.bodies.read_text`, shared with the harvesters), quiz choices included.
- The schema makes every span cite (`cites` ≥ 1), not just the grounding gate; threads hold
  3–6 pills, at most 3 threads and 10 standalone pills; quizzes 3–4 choices.
- `app.pills.checks` (registered in `app.papers.checks.CHECKS`): quiz answer in range,
  thread size, and near-duplicates — a pill's normalized headline or first 12 words equal
  to, or sharing ≥ 80 % of their words with, a `harvested[].text` or another pill's.
- A pill's `cites` gains any anchor its spans cite that the list left out (harvester).
- `generate.top_up(session, document_ids, unseen)` takes the feed's resolved scope
  (`feed.scope.resolve`, the one source resolver: unknown refs are a `404` before any
  top-up). It skips a chapter with a make-pills job queued today (whatever its outcome),
  so a failing chapter costs one try a day; the cap counts every make-pills job created
  since midnight UTC, explicit ones included. `POST /pills/generate` (`enqueue`) is not
  capped. Ranking across documents: in progress, then each document's next unread chapter
  (the first open one past the furthest chapter read; an unopened book's first), then the
  rest; the most recently read document first within a rank.
- Jobs: `derive`, priority 110, `input_hash` key `skill:make-pills:<style>` (the manual-job key,
  so the queue dedupes both). `estimate_tokens` averages per job (retries summed) all
  tokens (input, output, cache reads and writes), falling back to the other explore-tier
  derive skills' average.

### Feed engine and API (§6, §7)

Modules: `app/pills/feed/{config,scope,candidates,history,rank,mixer,render,sessions,summary}.py`,
`app/pills/{events,reviews,supply,feeds}.py`. `rank` and `mixer` are pure.

- **Sources**: documents and collections by uuid or slug, paper sets by uuid or name,
  concepts by uuid or name (case-insensitive, aliases included). An unknown ref is a `404`.
  With concepts, a pill qualifies when its document is named outright *or* its concepts
  overlap (a union, like the documents).
- **Units by mode** (`scope.allowed_units`): read = all of a finished document, units at
  `FINISHED` progress (0.97) and those before the latest reading position. *Preview*: the
  first 2 unread chapters. *Explore* without spoilers: a started document's read units plus
  the one in progress; an unstarted document whole. Consolidate falls back to explore when
  nothing in scope is read.
- **Buckets**: explore uses the §6 mix (serendipity = pills of documents you have not
  started); consolidate folds serendipity into main (70/20/10); preview is main only;
  review is due items only. Reviews join consolidate and explore when `kinds` allows them.
- **Score terms**: `scope_match` = 1, +0.5 for a unit read in the last week (consolidate),
  +0.25 per concept matched beyond the first, reviews 1–2 by how overdue; `spacing` =
  1 / (1 + 0.2 × pills of that unit seen in the last day); `draft_penalty` 0.8; a
  ±3 % seeded jitter. Kind affinity = (saves + ½ long dwells (≥ 12 s) − ½ skips − ¾ too_easy −
  ½ confusing) / max(views, 4), clamped. The "unit seen this session" novelty term is the
  mixer's (× 0.5 per pill of that unit already served).
- **Mixer precedence**: threads (whole and ordered, may run past the page or the rhythm) >
  every 4th pill active > no consecutive unit > bucket shares.
- **Sessions**: pages extend `served` lazily (≥ 20 at a time, seed `seed + len(served)`),
  capped at `length`. `position` (resume point) is moved by `seen` events carrying the
  session id, never back. `done` (= `next_cursor` null) also when the scope runs dry. A
  finished session can still be paged.
- **Events**: `{accepted, duplicates, ignored}` — `ignored` counts events whose pill or
  review item no longer exists (an offline queue must not jam); an unknown `session_id` is
  dropped. Each event needs a `pill_id` or `review_item_id` (else `422`). Side effects run
  once, for newly recorded events, in `at` order. An `answer` on a review pill is only
  recorded: the client rates the item through `POST /reviews/{id}/rating`.
- **Review cards from pills**: prompt = front, question, `What is <term>?` (definitions),
  headline, else the first span; answer = the kind's spans (a quiz's right choice first; a
  quote's or claim's text; a connection's own side), own-document cites only.
- **Confusing**: counted per `pill_set` since its last verdict (`reviewed_at`); flagging
  queues a harvest so its pills turn draft. Approved and draft sets are flagged; rejected or
  already flagged ones are left.
- **Summary**: `minutes` from dwell (else the pills' estimates), at least 1 once anything was
  seen; `due_tomorrow` = items due within 24 h across the shelf; `next_read` = the latest
  reading position among the scope's unfinished documents (the next chapter when that one
  is finished), else the unit of the first pill served.
- **Supply**: `generatable` is `[{anchor, title, estimate_tokens}]` (per chapter, from
  `generate.estimate_tokens(…, 1)`; null without history), not bare anchors; review feeds
  count explore units. Every page reports supply and calls `generate.top_up` when it is low
  (not in review mode).
- `POST /pills/sessions` is `201`; `POST /pills/generate` and `POST /pills/rebuild` are
  `202`; saved feeds list as `{items}`; `GET /pills/sessions/{id}` takes `limit` 1–50.
  `length` accepts 1–200 or null.
- **Drift**: `contracts/pill.examples.json` holds, beside one pill per kind, one body per
  API response (`api`); the backend checks each against its response model and the
  frontend checks its typed fixtures' fields against them (`lib/pills/types.test.ts`).

### Web client (§8, §9)

- The feed sizes itself to end at the foot of the screen whatever the masthead measures
  (`useFeedTop` sets `--feed-top`); moving by key or button scrolls the feed only, never
  the page.
- A review pill asks for an attempt before it shows the answer, like Due today (the review
  path logs what you recalled), then rates 1–4.
- The supply panel shows each chapter's heading and token estimate before "Make pills".
