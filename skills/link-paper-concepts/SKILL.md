---
name: link-paper-concepts
description: Build a scientific paper's slice of the Bookshelf idea graph from its unit distillations, paper card and results table — the methods, datasets, metrics and tasks it proposes or uses, and the concepts, frameworks, terms, people and works it treats (canonical names lowercase and singular, reusing concepts already on the shelf) — with proposed edges between concepts and passages, each backed by evidence anchors. Use for a paper's concept_links (after embed) or when the user asks to link a paper's concepts, e.g. `/link-paper-concepts vaswani-attention`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `vaswani-attention`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/link-paper-concepts/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user; review every proposed `same_as` and
   every reuse of an existing concept with them, above all dataset and metric names.
3. Write `{"skill": "link-paper-concepts", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/link-paper-concepts-<slug>.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict; edges land as `proposed` for review.
<!-- interactive:end -->

# Link a paper's concepts

## Role

You add one paper to the reader's idea graph. Papers meet each other **through shared
concepts**: the same method, the same benchmark, the same metric, the same task. Those names
also line up the results of different papers in one comparison table, so naming them
exactly like the shelf already does matters more than anything else. Every edge you emit is
a *proposal* a human accepts or rejects.

Your input:
- `unit_distillations: [{anchor, heading, role, body}]` — each section's cited study note.
- `paper_card` — the paper's card (contributions, method, `setup {datasets, baselines,
  metrics}`, results), or `null`.
- `results_table` — `{rows: [{method, dataset, metric, value, unit, higher_is_better,
  is_proposed, cites}]}`, or `null` before the results are extracted.
- `existing_concepts: [{canonical, aliases, kind}]` — the concepts already on the shelf.

## Method

1. **Harvest candidates**: the paper's proposed method and its named components; every
   baseline, dataset, benchmark and metric in `paper_card.setup` and `results_table`; the task
   it addresses; `definition` terms and `"mark": "strong"` key terms of the distillations;
   frameworks, people and works it engages with at length (not name-drops).
2. **Filter.** Keep a candidate only if the paper defines it, proposes it, measures with it,
   evaluates on it, or uses it as a load-bearing tool. Drop generic words ("model", "data",
   "performance"). Typically 10–40 concepts per paper.
3. **Canonicalise** each name: lowercase, singular, no leading article; acronyms expanded
   in the canonical name with the acronym as an alias (`long short-term memory`, alias
   `lstm`), unless the acronym *is* the name everyone uses (`bleu`, `imagenet`). Variants the
   results table spells differently ("Transformer (big)", "WMT14 En-De") become aliases of
   one concept, so the comparison can join them.
4. **Reuse before you create.** Compare every candidate with `existing_concepts`
   (canonical and aliases, ignoring case, plural, acronym and year-suffix variants). On a
   match, use the existing `canonical` **and** `kind` exactly; list in `aliases` only this
   paper's variant names not already there. Never emit a second concept for something already
   on the shelf.
5. **Near-duplicates you are unsure about** ("wmt 2014 english-german" vs an existing "wmt
   english-german"): do not merge. Emit this paper's concept and a `same_as` edge between the
   two, weight ≤ 0.6, evidence = where this paper names its term.
6. **`kind`**: `method` (an algorithm, model, architecture or training procedure — the
   paper's own and its baselines), `dataset` (a dataset, corpus or benchmark), `metric` (a
   measure of quality or cost), `task` (the problem solved: "machine translation", "question
   answering"), `concept` (an idea or phenomenon), `framework` (a named theory or model with
   parts), `term` (vocabulary defined narrowly), `person`, `work` (a paper or book discussed
   at length).
7. **`blurb`**: one or two spans saying what *this paper* means by or does with the concept,
   cited.
8. **Edges.** Each reads *src relation dst*. Endpoints are `{"kind": "concept", "ref":
   <canonical>}` (in your `concepts` or `existing_concepts`) or `{"kind": "node", "ref":
   <anchor>}` (a passage in the input):
   - `defines` — node → concept: where the paper defines or introduces it (one per concept).
   - `mentions` — node → concept: a passage that uses it in a load-bearing way (≤ 3 per
     concept): the result table that evaluates on a dataset, the setup that names a metric.
   - `supports` — node or concept → concept: evidence for it (a result table supports the
     proposed method).
   - `contradicts` — the paper sets the two against each other, or a result refutes a claim.
   - `extends` — concept → concept: the paper's method builds on, modifies or generalises
     another (the proposed method extends a baseline it modifies).
   - `example_of` — node or concept → concept: an instance or sub-type (a benchmark that is an
     instance of a broader dataset family, a variant of a method).
   - `same_as` — concept → concept: a proposed duplicate (step 5).
9. **`weight`** (0.3–1): 1.0 stated explicitly; ~0.7 clearly argued; ~0.4 implied. Below 0.3,
   leave the edge out.
10. **`evidence`**: 1–5 anchors where the relation is stated or shown, most specific first
    (a results row's `cites` is good evidence for a dataset or metric edge).

## Hard rules

1. **Only the given input.** Concepts and relations the paper states or shows — never what you
   know about the field. Cross-paper links come only from reusing existing canonical names.
2. **Every blurb span cites ≥ 1 anchor and every edge has ≥ 1 `evidence` anchor**, copied
   verbatim from the input (the block anchors inside the distillations, the card and the
   results rows, or a unit anchor for a section-wide claim). Never construct, guess or
   shorten an anchor.
3. **Canonical names are lowercase and singular**, no trailing punctuation, identical wherever
   the same concept appears.
4. **Every concept endpoint exists** in your `concepts` or in `existing_concepts`; every node
   endpoint is an anchor that appears in the input.
5. **No duplicates**: one concept per idea, one edge per (src, relation, dst).
6. **Thin input**: return the few concepts that are clearly defined, with their `defines`
   edges, or `{"concepts": [], "edges": []}`. Never pad.

## Output

One JSON object: `{"concepts": [{"canonical", "aliases", "kind", "blurb"}], "edges": [{"src", "dst", "relation", "weight", "evidence"}]}`.

## Example

Input (excerpt): distillation spans "the Transformer: encoder and decoder built only from attention" (cites `ch02/p001`), "attention relates positions of one sequence" (cites `ch02/s02/p001`); `results_table` rows `{"method": "Transformer (big)", "dataset": "WMT 2014 English-German", "metric": "BLEU", "value": 28.4, "cites": ["ch06/t001"]}`; `existing_concepts` = `[{"canonical": "attention", "aliases": ["attention mechanism"], "kind": "concept"}, {"canonical": "bleu", "aliases": [], "kind": "metric"}]`.

```json
{
  "concepts": [
    {"canonical": "transformer", "aliases": ["transformer (big)"], "kind": "method", "blurb": [
      {"text": "An encoder-decoder built only from attention and feed-forward layers.", "cites": ["ch02/p001"]}]},
    {"canonical": "wmt 2014 english-german", "aliases": [], "kind": "dataset", "blurb": [
      {"text": "The translation benchmark of the main results.", "cites": ["ch06/t001"]}]},
    {"canonical": "bleu", "aliases": [], "kind": "metric", "blurb": [
      {"text": "The score every translation result is reported in.", "cites": ["ch06/t001"]}]}
  ],
  "edges": [
    {"src": {"kind": "node", "ref": "ch02/p001"}, "dst": {"kind": "concept", "ref": "transformer"}, "relation": "defines", "weight": 1, "evidence": ["ch02/p001"]},
    {"src": {"kind": "concept", "ref": "transformer"}, "dst": {"kind": "concept", "ref": "attention"}, "relation": "extends", "weight": 0.8, "evidence": ["ch02/s02/p001"]},
    {"src": {"kind": "node", "ref": "ch06/t001"}, "dst": {"kind": "concept", "ref": "transformer"}, "relation": "supports", "weight": 0.9, "evidence": ["ch06/t001"]},
    {"src": {"kind": "node", "ref": "ch06/t001"}, "dst": {"kind": "concept", "ref": "wmt 2014 english-german"}, "relation": "mentions", "weight": 0.7, "evidence": ["ch06/t001"]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
