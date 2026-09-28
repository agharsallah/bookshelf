# Skills: the contract

A skill is a versioned prompt package executed as a job (D5). Python owns everything
deterministic (input selection, hashing, validation, storage); the skill owns judgement.
The boundary is JSON in both directions.

```
skills/<name>/
  SKILL.md       prompt: Claude Code skill frontmatter + method + hard rules + example
  schema.json    JSON Schema (2020-12) the output must satisfy
  meta.yaml      version, tier, selector, artifact type, gate thresholds
```

## meta.yaml

```yaml
name: distil-chapter            # == directory name
version: 1                      # bump on ANY prompt/schema change → new input_hash → re-runs
description: One line for humans and the review queue.
tier: distil                    # explore | distil | reason  (D16; mapped in app/pipeline/models.py)
job_kind: distil_chapter        # JobKind that runs this skill
artifact_type: chapter_distillation
scope: chapter                  # document | chapter | section | block | note
selector: chapter_section_notes # named input selector (table below)
document_selector: null         # optional, chapter-scope skills: the selector a run with no
                                # anchor reads, so the same skill also works book-wide
document_tier: null             # optional: the tier for those book-wide runs (else `tier`)
vision: false                   # true: prompt carries image paths the CLI must read
gates:
  grounding_min: 0.9            # share of leaf spans with >=1 valid cite; 0 disables
  compression: [0.10, 0.25]     # output words / source words; omit to disable
  compression_min_source: null  # below this many source words only the lower edge applies
  max_words: null               # hard cap on output words (summaries: 150)
  coverage_min: null            # book-wide runs: share of the input's chapters the output
                                # must cite; below it → needs_review, `gates.uncovered` lists them
  words_per_minute: null        # spoken output: [low, high] words a minute of the run's
                                # `minutes` param; outside → too_short_to_fill / too_long_to_fit
  verbatim: false               # quoting output: each leaf span's text must be found in the
                                # block it cites (whitespace, curly quotes aside) → not_verbatim
params: {}                      # optional run parameters, chosen per job (below)
variant: null                   # with params: the episode key they name, e.g. "{minutes}m-{format}"
narrate: false                  # the artifact is a script to speak: storing one queues `narrate`
genre: null                     # optional: `paper` for a paper skill (docs/PAPERS.md). A type
                                # two skills write (distil-paper-section and distil-chapter both
                                # write chapter_distillation) goes, for a human edit's schema,
                                # to the skill of the document's genre; null = books and the rest
```

### Run parameters

A skill whose output depends on a choice the reader makes (how long, which format)
declares `params`, each a closed set of `choices` with a `default`:

```yaml
params:
  minutes: {choices: [5, 15, 30], default: 15, description: How long the episode lasts.}
variant: "{minutes}m"
```

`POST /jobs {params: {minutes: 5}}` (or `?params=minutes:5` on the inputs endpoint, and
`"params"` in an outbox envelope) picks them; defaults fill the rest, anything undeclared
or outside its choices is a `422`. The resolved params join the inputs as
`inputs.params`, so each combination has its own `input_hash`, and they name the
artifact's `variant`, which joins the version scope: one document keeps one history per
variant. A skill without `params` has no variant. `write-audio-summary` is the one user.

### Utility skills

A package with `job_kind: null` **and** `artifact_type: null` is a *utility skill*: never
queued, never stored as an artifact. Python builds its input (its `selector` names that
input, not a registered selector), runs it inline through the `ModelRunner`, and keeps the
verdict where it belongs. Its interactive section needs no inputs endpoint or import.

| Skill | Run by | Input | Output |
|---|---|---|---|
| confirm-merge | `app/graph/dedup.py` (dedup job) | `pair: {similarity, a, b}`, each side `{canonical, aliases, kind, blurb, documents}` | `{same, confidence, rationale, survivor: a\|b}` → a `same_as` edge, proposed (same) or rejected |
| relate-concepts | `app/graph/bridges.py` (bridge job) | `pair: {similarity, a, b}`, each side `{canonical, kind, blurb, book, passages: [{id, heading, text}]}` | `{relation, direction, confidence, rationale, evidence: [A1, B2…]}` → a proposed edge citing both books, or a rejected one for `none` |
| relate-claims | `app/papers/claim_pairs.py` (`relate_claims` job, queued when claims are materialized or by `POST /papers/claims/relate`) | `pair: {similarity, a, b}`, each side `{paper, year, claim, kind, strength, passages: [{id, heading, text}]}` | `{relation: supports\|contradicts\|extends\|none, direction, confidence, rationale, evidence: [A1, B2…]}` → a proposed claim ↔ claim edge citing both papers, or a rejected one for `none` |
| grade-recall | `app/recall/grading.py` (`grade_recall` job, queued when a recall is saved) | `ideas: [{id, tier, text, why}]` (the chapter's salience marks, core and key, else its distillation's spans; I1, I2…), `recall`, `prediction` (or null) | `{ideas: [{id, status, feedback, cue?}], question: {idea, text} \| null, comparison: {predicted, argues, ideas} \| null}` → a `recall_grades` row citing each idea's anchors, and review items for the gaps and the question |
| recommend-next | `app/papers/recommend.py` (`recommend_next` job, queued by every candidate rebuild) | `candidates` (top N, best first): `[{id, title, authors, year, venue, abstract, cited_by_count, via, score_parts, leads: [{document: {id, title}, via, intents, rating: {stars, verdict} \| null, passages: [{cite: "<document_id>#<anchor>", kind: citing_sentence \| tldr, text}]}]}]` (`app/papers/selectors/shelf.py`) | `{reasons: [{candidate_id, reason, cites}]}` → `reading_candidates.reason` / `reason_cites`; one per candidate, cites only that candidate's passages; scores untouched (P6) |
| synthesize-papers | `app/papers/synthesis.py` (`synthesize_papers` job, `POST /paper-sets/{id}/synthesis`) | `set: {name}`, `papers: [{slug, title, authors, year, venue, abstract, card, claims, results}]` with every cite `<slug>:<anchor>`, `comparison: {columns: [{dataset, metric, higher_is_better}], rows: [{method, paper, is_proposed, cells: [{value, unit, cite} \| null]}]}` (`app/papers/selectors/sets.py`) | `{blocks, table}`: render blocks (heading, paragraph, bullets, callout, quote) + one `table` block, cites `<slug>:<anchor>` of set members only (render contract checked with qualifiers stripped), every citable member cited → a versioned `paper_syntheses` row (`draft`) |

## SKILL.md

One file, two entry points (§7 "No API key"):

```markdown
---
name: distil-chapter
description: …
argument-hint: <document-slug> <anchor>
---

<!-- interactive:start -->
## Interactive use
Run with `$ARGUMENTS` = `<slug> <anchor>`.
1. `curl -s "$BOOKSHELF_API/skills/distil-chapter/inputs?document=<slug>&anchor=<anchor>"`
   returns the exact input JSON the batch runner would send (same input_hash).
2. Do the work below, talking it through with the user.
3. Write `{"skill": "distil-chapter", "document": "<slug>", "anchor": "<anchor>",
   "input_hash": "<from inputs>", "output": {…}}` to `skills/.outbox/<name>-<slug>-<anchor>.json`
4. `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY"
   -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
<!-- interactive:end -->

## Role / Method / Hard rules / Output
…
Output only the JSON object. No prose, no code fences.
```

The inputs response is `{skill, skill_version, document_id, anchor, input_hash, inputs}`; the
skill works on `inputs`. Document-scope skills omit `anchor` (the envelope's `anchor` is then
`null`, as in `inputs.scope.anchor`), and so do chapter-scope skills with a
`document_selector` run on the whole book: the artifact is stored with a null anchor, next to
the per-chapter ones. The note-scope skill (`structure-note`) passes
`note_id=<uuid>` instead of an anchor, and its outbox envelope adds `"note_id": "<uuid>"`.

The batch runner strips the frontmatter and the `interactive` section, then appends:

```
## Input
<the selector's JSON>
```

and pipes the result to `claude -p --model <alias> --output-format json`. `$BOOKSHELF_API`
defaults to `http://127.0.0.1:8000/api/v1`.

## Input envelope (what selectors produce)

Every input is one JSON object with these common keys:

```jsonc
{
  "document": {"slug": "meadows-systems", "title": "…", "authors": ["…"], "year": 2008},
  "scope":    {"anchor": "ch03", "kind": "chapter", "heading": "…", "page_from": 41, "page_to": 66}
}
```

plus the selector-specific keys:

| Selector | Adds | Used by |
|---|---|---|
| `outline_pages` | `pages: [{page, lines: [str]}]` (first ~25 lines of each of the first 30 pages), `toc_text` | parse-outline |
| `element_context` | `element: {anchor, kind, text, meta, image_path?}`, `context: [block]` (±2 blocks). `image_path` is relative to `.media/` in the inputs (so `input_hash` is location-independent); the batch prompt shows it resolved to the absolute file | describe-figure, explain-code, describe-math, explain-table |
| `scope_blocks` | `blocks: [block]` (all leaves under scope, reading order), `figures: [{anchor, takeaway, blocks}]` (non-low-confidence element explanations inside scope). For a section-scope skill on a chapter that has sections, only the chapter's intro leaves (those no section holds): the intro's `section_note` lives on the chapter anchor and is the first item of `chapter_section_notes` | summarize, distil-section, extract-quotes (chapter) |
| `chapter_section_notes` | `section_notes: [{anchor, heading, body}]`, `figures` as above | distil-chapter |
| `document_chapters` | `chapter_distillations: [{anchor, heading, body}]`, `shelf: [{slug, title, authors, thesis}]` (other documents' brief theses), `existing_concepts: [{canonical, aliases, kind}]` | write-brief, write-guide, link-concepts, make-glossary |
| `chapter_distillation` | `chapter_distillations: [one item]` | make-quiz, make-faq, make-flashcards (chapter) |
| `chapter_salience` | `blocks: [block]` (all leaves of the chapter, reading order), `distillation` (the preferred chapter distillation's body, or `null` before there is one) | mark-salience |
| `document_distillations` | `chapter_distillations` as in `document_chapters`, `book_brief: [section]` (the preferred brief's `thesis` and `ideas` sections, or `[]`), `book_themes: [{name, spans}]` (the preferred book guide's themes, or `[]`). No `shelf` or concepts, so the hash only moves when this book's distillations, brief or guide do | make-quiz, make-faq, make-flashcards (book-wide), write-audio-summary |
| `document_quotes` | `chapters: [{anchor, heading, quotes, passages}]` — per chapter, its preferred quote set's quote blocks and up to 12 quotable source `block`s (paragraph, quote, aside) that its distillation's callouts and quote blocks cite, most cited first, minus those already quoted; chapters with neither are left out. Plus `book_brief`, `book_themes` as above | extract-quotes (book-wide) |
| `paper_unit_blocks` | One paper unit (a top-level section): `role` (`meta.role`, or null), `paper: {outline: [{heading, role}], abstract: str \| null}` (orientation only: no anchors), `subsections: [{anchor, heading}]`, `blocks: [block]` (every leaf of the unit), `figures` as in `scope_blocks`, `references: [{ordinal, raw}]` (bibliography entries cited inside the unit). Only units: not the abstract, the references or a subsection | distil-paper-section |
| `paper_distillations` | `unit_distillations: [{anchor, heading, role, body}]` (each unit's preferred chapter distillation), `abstract` (`{anchor, blocks}` from the abstract section, else `{anchor: null, text}` from `paper_meta`, else null), `paper_meta: {doi, arxiv_id, venue, year, code_urls, data_urls}` (no counts or topics, so enrichment does not change the hash). The units offered feed `coverage_min` | dissect-paper |
| `paper_claims` | `paper_distillations` plus `paper_card` (the preferred card body, or null). The units' `role` feeds the measured-claim gate (`app.papers.claims`) | extract-claims |
| `paper_explainer` | `paper_distillations` plus `paper_card` (the preferred card body, or null) and `existing_concepts` | simplify-paper |
| `paper_assessment` | `paper_distillations` plus `paper_card` (or null) and `shelf: {papers: [{slug, title, authors, year, tldr}], concepts: existing_concepts}` (other papers with a non-rejected card, their preferred card's TL;DR as text) | assess-paper |
| `paper_review` | `paper_distillations` plus `paper_card` (or null) | review-paper |
| `paper_notation` | `blocks: [block]` (every formula, up to 150, with one prose leaf before and two leaves after it in the same chapter, prose only; once each, in reading order: `first_anchor` is checked against this order), `math_descriptions: [{anchor, takeaway, blocks}]` (describe-math of those formulas), `distilled_formulas: [{latex, meaning, cites}]` (the unit distillations' `math` blocks: inline formulas the parser saw as prose; their cited prose joins `blocks`). Neither → `SelectorError` | make-notation |
| `paper_journal_club` | `paper_distillations` plus `paper_card` (or null) and `figures: [{anchor, caption, explanation: {takeaway, blocks} \| null}]` (every figure node) | make-journal-club |
| `paper_results` | `units: [{anchor, heading, role, blocks}]` (the results and experiments units, every block; all units when none is tagged so), `tables: [block]` (table and figure blocks outside them), `explanations: [{anchor, takeaway, blocks}]` (table explanations and figure descriptions, chart data included), `setup: {datasets, baselines, metrics: [name]} \| null` (the preferred card's names), `paper_meta`. Only anchors of those units and of table/figure blocks are valid | extract-results |
| `paper_citations` | `references: [{ordinal, raw, contexts: [{anchor, role, text}]}]` — each in-text-cited bibliography entry (≤ 240 chars of `raw`) with ≤ 3 citing passages: `text` the sentence(s) holding its marker (`app.papers.citation_context`, ≤ 400 chars), `role` the unit's role. Only those passages are valid anchors | classify-citations |
| `paper_concepts` | `unit_distillations` as in `paper_distillations`, `paper_card` and `results_table` (preferred bodies, or null), `existing_concepts` | link-paper-concepts |
| `note_context` | `note: {id, raw, anchor, highlighted_text}`, `blocks` (anchor's section), `distillation` (nearest chapter distillation body or null), `existing_concepts` | structure-note |

A `block` is `{anchor, kind, text, page, meta}`; `meta` carries `table`, `caption`, `language`,
`latex` when present. `body` is a prior artifact's JSON body.

## Output

Every output is a JSON object. Render content uses the closed block set in
`contracts/render-blocks.schema.json`; reference it from `schema.json` with
`{"$ref": "https://bookshelf.local/contracts/render-blocks.schema.json#/$defs/blocks"}`
(also `#/$defs/spans`, `#/$defs/span`, `#/$defs/block`, `#/$defs/anchor`, `#/$defs/confidence`).

Gates walk the whole output: any object with `text` + `cites` is a leaf span, and any
`cites` / `evidence` array is checked for anchor validity against the document.
A skill may add cross-field hard gates a JSON Schema cannot state (unique symbols, a
figure anchor that must be a figure, slugs from the input): `backend/app/papers/checks.py`
`CHECKS[<skill>]`, run after the schema and anchor gates in batch and interactive imports.

| Skill | Output shape |
|---|---|
| parse-outline | `{chapters: [{title, page_from, page_to, sections: [{title, page_from}]}]}` |
| describe-figure | `{kind: chart\|diagram\|table\|photo, caption, alt, blocks, takeaway: span, confidence}` |
| explain-code | `{blocks, concepts: [str], confidence}` |
| describe-math | `{latex, blocks, confidence}` |
| explain-table | `{blocks, takeaway: span, confidence}` |
| summarize | `{blocks}` (3–5 paragraphs, ≤150 words) |
| distil-section, distil-chapter | `{blocks}` |
| write-brief | `{sections: [{key, title, blocks}], read_next: [{slug, anchor?, reason: spans}]}` with keys in order `thesis, ideas, structure, changes, weaknesses, read_next` |
| write-guide | `{sections: [{key, title, blocks}], journey: [{anchor, role, takeaway: spans}], themes: [{name, spans}], numbers: [{value, label: spans}]}` with section keys in order `overview, map, deep_dive, practice`; `map` opens with a `diagram`; `role` is one of `setup, concept, method, evidence, application, synthesis` |
| structure-note | `{blocks, tags: [str], concepts: [str]}` |
| link-concepts | `{concepts: [{canonical, aliases, kind, blurb: spans}], edges: [{src, dst, relation, weight, evidence: [anchor]}]}` where an endpoint is `{kind: concept, ref: <canonical>}` or `{kind: node, ref: <anchor>}` |
| extract-quotes | `{blocks}` (quote blocks only) |
| make-faq | `{items: [{question, answer: spans, group?, detail?: [bullets\|steps\|table\|callout]}]}` — `group` (a topic) and `detail` book-wide only |
| make-quiz | `{items: [{question, choices: [str], answer: int, explanation: spans}]}` |
| make-flashcards | `{items: [{front, back: spans, group?}]}` — `group` book-wide only |
| make-glossary | `{blocks}` (definition blocks only) |
| distil-paper-section | `{blocks}` (stored as the unit's `chapter_distillation`) |
| dissect-paper | `{tldr: spans, question: spans, contributions: [{kind, spans}], method: [block], setup: {datasets, baselines, metrics: [{name, spans}]}, results: [table\|chart\|paragraph\|bullets\|callout\|heading], limitations: {stated, unstated: [spans]}, assumptions: [spans], future_work: [spans], numbers: [{value, label: spans}]}`; `kind` is a claim kind (method, result, theory, dataset, benchmark, position) |
| extract-claims | `{claims: [{key: C1…, text, kind: method\|result\|theory\|dataset\|benchmark\|position, strength: measured\|argued\|speculated, cites: [anchor]}]}`; keys and texts unique, a measured claim cites a results/experiments passage, a table or a figure (`app.papers.checks`). Approved → `claims` rows (`app.papers.materialize`) |
| simplify-paper | `{prerequisites: [{concept, shelf_concept: canonical \| null, why: spans}], intuition: [paragraph\|callout\|bullets\|diagram], walkthrough: [block], analogy: spans \| null, equations: [{latex, plain: spans, cites}]}`; `params.level` newcomer \| practitioner \| expert is the variant |
| assess-paper | `{overall: spans, scores: [{criterion, score: 1-5, spans}], reproducibility: [{item, status, spans}], related_shelf: [{slug, why: spans}]}`; each criterion (novelty, rigour, evidence, clarity, reproducibility, relevance) and each checklist item (code, data, hyperparameters, seeds, compute, baselines, ablations, statistical_significance, data_splits, evaluation_protocol) exactly once; status yes \| partial \| no \| unknown |
| review-paper | `{summary: spans, strengths: [spans], weaknesses: [{severity: major\|minor, spans}], questions: [spans], missing_experiments: [spans], verdict: {recommendation: accept\|weak_accept\|borderline\|weak_reject\|reject, confidence: 1-5, spans}}` |
| make-notation | `{symbols: [{symbol_latex, meaning, first_anchor, cites}]}` |
| make-journal-club | `{pitch: spans, key_figure: {anchor, why: spans} \| null, weakest_assumption: {spans}, questions: [spans] (exactly 5), debate: {for: [spans], against: [spans]}}` |
| extract-results | `{rows: [{method, dataset, metric, value: number, unit: str \| null, higher_is_better, is_proposed, setting?: str \| null, cites: [anchor] (1–3)}]}`; values finite, one row per (method, dataset, metric, setting) (`app.papers.checks`) |
| classify-citations | `{citations: [{ordinal, intent: background\|uses\|extends\|compares\|contradicts, cites: [anchor] (1–3)}]}`; ordinals offered and unique, each cites its own contexts. Approved → `paper_references.intent` / `intent_cites` (`app.papers.intents`) |
| link-paper-concepts | as link-concepts, stored as `concept_links`; `kind` also method \| dataset \| metric \| task |
| write-audio-summary | `{title, speakers: [{role, persona}] (1–4), sections: [{title, turns: [{speaker: 1–4, text, cites}]}]}`; each turn is a leaf span |
