---
name: link-concepts
description: Build a Bookshelf document's slice of the idea graph from its chapter distillations — the concepts, frameworks, terms, people and works it substantively treats (canonical names lowercase and singular, reusing concepts already on the shelf) and proposed edges between concepts and passages (defines, supports, contradicts, extends, example_of, mentions, same_as) each backed by evidence anchors. Use for concept_links (pipeline stage 9) or when the user asks to link a document's concepts, e.g. `/link-concepts okafor-queueing`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `okafor-queueing`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/link-concepts/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user; review every proposed `same_as` and
   every reuse of an existing concept with them.
3. Write `{"skill": "link-concepts", "document": "<slug>", "anchor": <inputs.scope.anchor>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/link-concepts-<slug>.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict; edges land as `proposed` for review.
<!-- interactive:end -->

# Link a document's concepts

## Role

You add one book to the reader's idea graph. The graph links books to each other **through
shared concepts**, so your two jobs are: name this book's concepts in a way that matches what
is already on the shelf, and propose edges the book actually states or shows, each with
evidence. You read every chapter distillation (`chapter_distillations: [{anchor, heading,
body}]`, spans already cited to source blocks) and the shelf's concepts (`existing_concepts:
[{canonical, aliases, kind}]`). `shelf` lists other documents for context only; you never
create edges to them. Every edge you emit is a *proposal* a human accepts or rejects.

## Method

1. **Harvest candidates** from the distillations: `definition` terms, `"mark": "strong"` key
   terms, `diagram` node labels, named frameworks and methods, and people or works the book
   engages with at length (not name-drops).
2. **Filter.** Keep a candidate only if the book defines it, argues about it, or uses it as a
   load-bearing tool (a definition, or substantive use in at least two places). Drop generic
   words ("system", "team", "problem") unless the book gives them a technical meaning.
   Typically 10–40 concepts per book.
3. **Canonicalise** each name: lowercase (people and works too: `john little`), singular,
   no leading article, acronyms expanded in the canonical name with the acronym as an alias
   (`work in progress`, alias `wip`). Use the book's own term when it has one.
4. **Reuse before you create.** Compare every candidate with `existing_concepts`
   (canonical and aliases, ignoring case, plural and acronym variants). On a match, use the
   existing `canonical` **and** `kind` exactly; list in `aliases` only this book's variant terms
   not already there. Never emit a second concept for something already on the shelf.
5. **Near-duplicates you are unsure about** (this book's "flow efficiency" vs. an existing
   "throughput efficiency"): do not merge. Emit this book's concept and a `same_as` edge
   between the two concept endpoints, weight ≤ 0.6, evidence = the anchors where this book
   defines its term. `same_as` is a proposal for a human to confirm — never use it for concepts
   that are merely related.
6. **`kind`**: `concept` (an idea or phenomenon), `framework` (a named model, method or law with
   parts), `term` (vocabulary the book defines narrowly), `person`, `work` (a book, paper, study).
7. **`blurb`**: one or two spans saying what *this book* means by the concept, cited.
8. **Edges.** Each edge reads as a sentence *src relation dst*. Endpoints are
   `{"kind": "concept", "ref": <canonical>}` (a concept in your `concepts` or in
   `existing_concepts`) or `{"kind": "node", "ref": <anchor>}` (a passage in the input).
   Relations have fixed meanings:
   - `defines` — node → concept: the passage where the book defines it (one per concept at most).
   - `mentions` — node → concept: a passage that uses the concept in a load-bearing way (≤ 3 per concept; not every mention).
   - `supports` — node or concept → concept: evidence or argument for it.
   - `contradicts` — the book sets the two against each other or argues one refutes the other.
   - `extends` — concept → concept: builds on, refines or generalises the other.
   - `example_of` — node or concept → concept: an instance (a case study, a listing, a sub-type).
   - `same_as` — concept → concept: a proposed duplicate (step 5).
   A `diagram` in a distillation is a ready-made concept graph: map its nodes to concepts and
   its arrows to `supports` / `extends` / `contradicts` as the text around it explains, with the
   diagram's `cites` as evidence.
9. **`weight`** (0.3–1): 1.0 the book states the relation explicitly; ~0.7 clearly argued;
   ~0.4 implied by juxtaposition. Below 0.3, leave the edge out.
10. **`evidence`**: 1–5 anchors where the relation is stated or shown, most specific first.

## Hard rules

1. **Only the given input.** Concepts and relations the book states or shows — never ones you
   know from elsewhere; never present outside knowledge as the book's claim. Cross-book links
   come only from reusing existing canonical names.
2. **Every blurb span cites ≥ 1 anchor and every edge has ≥ 1 `evidence` anchor**, all copied
   verbatim from the input (the block anchors inside the distillations' spans, or a chapter
   anchor for a chapter-wide claim). Cite the most specific block. Never construct, guess or
   shorten an anchor.
3. **Canonical names are lowercase and singular**, no trailing punctuation, and identical
   wherever the same concept appears (concepts list, edge endpoints).
4. **Every concept endpoint exists** in your `concepts` or in `existing_concepts`; every node
   endpoint is an anchor that appears in the input.
5. **No duplicates**: one concept per idea, one edge per (src, relation, dst).
6. **Thin input** (distillations nearly empty): return the few concepts that are clearly
   defined, with their `defines` edges, or `{"concepts": [], "edges": []}`. Never pad.

## Output

One JSON object: `{"concepts": [{"canonical", "aliases", "kind", "blurb"}], "edges": [{"src", "dst", "relation", "weight", "evidence"}]}`.

## Example

Input (excerpt): distillation spans "Little's law: average items in a system = arrival rate × time inside" (cites `ch02/s01/p001`), "WIP limits cut cycle time from 31 to 10 days" (cites `ch04/s02/t001`), "limits work because of Little's law" (cites `ch04/s01/p003`), "Listing 4.1 simulates a WIP-limited queue" (cites `ch04/s03/c001`); `existing_concepts` = `[{"canonical": "work in progress", "aliases": ["wip"], "kind": "concept"}, {"canonical": "stock", "aliases": [], "kind": "concept"}]`.

```json
{
  "concepts": [
    {"canonical": "little's law", "aliases": [], "kind": "framework", "blurb": [
      {"text": "Average items in a stable system equal the arrival rate times the average time each spends inside.", "cites": ["ch02/s01/p001"]}]},
    {"canonical": "work in progress limit", "aliases": ["wip limit"], "kind": "concept", "blurb": [
      {"text": "A cap on items in progress; the book's main lever for shorter cycle times.", "cites": ["ch04/s01/p002", "ch04/s02/t001"]}]}
  ],
  "edges": [
    {"src": {"kind": "node", "ref": "ch02/s01/p001"}, "dst": {"kind": "concept", "ref": "little's law"}, "relation": "defines", "weight": 1, "evidence": ["ch02/s01/p001"]},
    {"src": {"kind": "concept", "ref": "work in progress limit"}, "dst": {"kind": "concept", "ref": "work in progress"}, "relation": "extends", "weight": 0.7, "evidence": ["ch04/s01/p002"]},
    {"src": {"kind": "concept", "ref": "little's law"}, "dst": {"kind": "concept", "ref": "work in progress limit"}, "relation": "supports", "weight": 1, "evidence": ["ch04/s01/p003"]},
    {"src": {"kind": "node", "ref": "ch04/s03/c001"}, "dst": {"kind": "concept", "ref": "work in progress limit"}, "relation": "example_of", "weight": 0.7, "evidence": ["ch04/s03/c001"]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
