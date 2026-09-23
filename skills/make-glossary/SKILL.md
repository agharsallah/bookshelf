---
name: make-glossary
description: Build the glossary of a Bookshelf document from all of its chapter distillations — one definition block per term the book defines, duplicates across chapters merged, the book's own sense of each term, alphabetical, every definition cited. Use for a glossary artifact (pipeline stage 10, derive) or when the user asks for a document's glossary, e.g. `/make-glossary okafor-queueing`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `okafor-queueing`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-glossary/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; review merged and borderline terms with the user.
3. Write `{"skill": "make-glossary", "document": "<slug>", "anchor": <inputs.scope.anchor>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-glossary-<slug>.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding).
<!-- interactive:end -->

# Make a glossary

## Role

You compile the book's vocabulary: every term it defines, once, in the book's own sense. The
glossary feeds concept linking and the idea graph, so consistency matters more than
elegance. You read every chapter distillation (`chapter_distillations: [{anchor, heading,
body}]`); `existing_concepts` tells you how the shelf already names things; `shelf` is not
used here.

## Method

1. **Collect** every `definition` block across all distillations, then terms the distillations
   define explicitly in a paragraph or callout ("X is …", "by X the author means …"), and
   symbols defined in `math` blocks' surroundings. Skip terms merely used, never defined.
2. **Group duplicates**: same term ignoring case, plural and acronym/expansion
   ("WIP" / "work in progress"). One entry per group.
3. **Name the term** as the book writes it, lowercase unless it is a proper noun or an
   acronym, singular, with the acronym in parentheses if the book uses one:
   "work in progress (WIP)". When the term matches an `existing_concepts` canonical name or
   alias, keep the book's wording but make sure the canonical name is recognisable in it.
4. **Write the definition** in 1–3 spans: the book's meaning, precisely, in plain words. If the
   author refines a term later, give the refined sense first, then a span "Introduced earlier
   as …" citing the earlier chapter. Cite each span with the anchors of the definition spans it
   draws on — one per chapter where the term is defined, most specific first.
5. **Order** entries alphabetically by term (ignoring case and leading symbols).

## Hard rules

1. **Only the given input.** Definitions are the book's, from the distillations. Never add a
   textbook definition or outside knowledge presented as the book's claim; a term the book uses
   in a non-standard way keeps the book's meaning.
2. **Every definition span cites ≥ 1 anchor** copied verbatim from the input — the block
   anchors inside the distillations' spans. Never construct, guess or shorten an anchor.
3. **Definition blocks only**, one per term, no duplicates.
4. **Verbatim material stays verbatim**: symbols, formulas and coined phrases are copied exactly.
5. **Thin input:** fewer entries; if the book defines nothing, `{"blocks": []}`. Never pad.

## Output

One JSON object: `{"blocks": [{"type": "definition", "term", "spans"}]}`, alphabetical.

## Example

Input (excerpt): `ch02` defines "Little's law" (cites `ch02/s01/p001`) and "stable system" (cites `ch02/s01/p003`); `ch04` defines "WIP limit" (cites `ch04/s01/p002`) and redefines "stable" as "arrivals and completions balance over the measurement window" (cites `ch04/s01/p004`).

```json
{
  "blocks": [
    {"type": "definition", "term": "Little's law", "spans": [
      {"text": "Over a long enough period, the average number of items in a system equals their arrival rate times the average time each spends inside.", "cites": ["ch02/s01/p001"]}]},
    {"type": "definition", "term": "stable system", "spans": [
      {"text": "A system whose arrivals and completions balance over the measurement window.", "cites": ["ch04/s01/p004"]},
      {"text": "Introduced earlier as one where items leave, on average, as fast as they arrive.", "cites": ["ch02/s01/p003"]}]},
    {"type": "definition", "term": "work in progress limit (WIP limit)", "spans": [
      {"text": "An explicit cap on the number of items a team or person may have started but not finished.", "cites": ["ch04/s01/p002"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
