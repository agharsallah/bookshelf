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
| write-audio-summary | `{title, speakers: [{role, persona}] (1–4), sections: [{title, turns: [{speaker: 1–4, text, cites}]}]}`; each turn is a leaf span |
