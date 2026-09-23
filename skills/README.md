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
vision: false                   # true: prompt carries image paths the CLI must read
gates:
  grounding_min: 0.9            # share of leaf spans with >=1 valid cite; 0 disables
  compression: [0.10, 0.25]     # output words / source words; omit to disable
  max_words: null               # hard cap on output words (summaries: 150)
```

### Utility skills

A package with `job_kind: null` **and** `artifact_type: null` is a *utility skill*: never
queued, never stored as an artifact. Python builds its input (its `selector` names that
input, not a registered selector), runs it inline through the `ModelRunner`, and keeps the
verdict where it belongs. Its interactive section needs no inputs endpoint or import.

| Skill | Run by | Input | Output |
|---|---|---|---|
| confirm-merge | `app/graph/dedup.py` (dedup job) | `pair: {similarity, a, b}`, each side `{canonical, aliases, kind, blurb, documents}` | `{same, confidence, rationale, survivor: a\|b}` → a `same_as` edge, proposed (same) or rejected |

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
`null`, as in `inputs.scope.anchor`). The note-scope skill (`structure-note`) passes
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
| `scope_blocks` | `blocks: [block]` (all leaves under scope, reading order), `figures: [{anchor, takeaway, blocks}]` (non-low-confidence element explanations inside scope). For a section-scope skill on a chapter that has sections, only the chapter's intro leaves (those no section holds): the intro's `section_note` lives on the chapter anchor and is the first item of `chapter_section_notes` | summarize, distil-section, extract-quotes |
| `chapter_section_notes` | `section_notes: [{anchor, heading, body}]`, `figures` as above | distil-chapter |
| `document_chapters` | `chapter_distillations: [{anchor, heading, body}]`, `shelf: [{slug, title, authors, thesis}]` (other documents' brief theses), `existing_concepts: [{canonical, aliases, kind}]` | write-brief, link-concepts, make-glossary, make-faq (document scope) |
| `chapter_distillation` | `chapter_distillations: [one item]` | make-quiz, make-faq (chapter), make-flashcards |
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
| structure-note | `{blocks, tags: [str], concepts: [str]}` |
| link-concepts | `{concepts: [{canonical, aliases, kind, blurb: spans}], edges: [{src, dst, relation, weight, evidence: [anchor]}]}` where an endpoint is `{kind: concept, ref: <canonical>}` or `{kind: node, ref: <anchor>}` |
| extract-quotes | `{blocks}` (quote blocks only) |
| make-faq | `{items: [{question, answer: spans}]}` |
| make-quiz | `{items: [{question, choices: [str], answer: int, explanation: spans}]}` |
| make-flashcards | `{items: [{front, back: spans}]}` |
| make-glossary | `{blocks}` (definition blocks only) |
