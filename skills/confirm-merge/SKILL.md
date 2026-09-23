---
name: confirm-merge
description: Decide whether two near-duplicate Bookshelf concepts (similar canonical names or blurbs, usually from different books) name the same idea, so the idea graph proposes a same_as merge only when a careful reader would agree. Use when the dedup pass finds a candidate pair, or when the user asks whether two concepts on the shelf are duplicates, e.g. `/confirm-merge <concept-id-a> <concept-id-b>`.
argument-hint: <concept-id-a> <concept-id-b>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<concept-id-a> <concept-id-b>`. This skill has no inputs endpoint and
stores no artifact; the backend runs it inline during dedup.

1. Fetch both sides with their evidence:
   `curl -s "$BOOKSHELF_API/concepts/<id>"` for each id
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`).
2. Do the work below with the user, reading the evidence passages of both.
3. On a yes, the user merges from the review queue, or:
   `curl -s -X POST "$BOOKSHELF_API/concepts/<loser>/merge" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data '{"into": "<survivor>"}'`
<!-- interactive:end -->

# Confirm a concept merge

## Role

You guard the idea graph against its worst failure: one idea split across several nodes,
or two different ideas fused into one. The input is one candidate pair, `pair.a` and
`pair.b`, each `{canonical, aliases, kind, blurb, documents}`, and `pair.similarity`, the
cosine similarity of their embeddings. Similarity only nominated the pair; it proves
nothing. You decide whether a careful reader of both books would call them the same idea.

## Method

1. **Read both blurbs** as definitions: what each book means by its term, not what the
   words usually mean.
2. **Same idea** means the definitions are interchangeable: one is a wording, acronym,
   spelling, plural or translation of the other, or the two books define the same thing in
   different words. A merge would lose nothing a reader cares about.
3. **Not the same** when one is a part, instance, measure, cause or refinement of the other
   (`work in progress` vs. `work in progress limit`), when they are opposites or rivals, or
   when the same word carries different technical meanings in the two books.
4. **Kinds** must be compatible: a `person` is never the same as a `concept`; a `work` is
   never the same as the idea it proposes.
5. **Thin blurbs** (missing or vague on one side): decide from the names only when they are
   unmistakable variants; otherwise answer not the same, with `confidence: low`.
6. **`survivor`**: the side whose canonical name is the clearer, more standard, unabbreviated
   term; on a tie, the one with more aliases.

## Hard rules

1. **Only the given input.** Judge from the two blurbs, names and kinds; never from what you
   know about the terms elsewhere.
2. **When in doubt, not the same.** A missed merge costs a click; a wrong merge corrupts the
   graph.
3. **`rationale`** is one or two sentences a reviewer can check against the blurbs, naming
   the deciding difference or equivalence.

## Output

One JSON object: `{"same": bool, "confidence": "high" | "medium" | "low", "rationale": str,
"survivor": "a" | "b"}`.

## Example

Input: `pair.a` = `{"canonical": "wip cap", "kind": "concept", "blurb": "A ceiling on how many
items may be in progress at once, set to shorten cycle time."}`, `pair.b` =
`{"canonical": "work in progress limit", "aliases": ["wip limit"], "kind": "concept",
"blurb": "A cap on items in progress; the book's main lever for shorter cycle times."}`,
`pair.similarity` = 0.91.

```json
{"same": true, "confidence": "high", "rationale": "Both blurbs define the cap on items in progress that shortens cycle time; 'wip cap' is one book's wording for the other's 'work in progress limit'.", "survivor": "b"}
```

Output only the JSON object. No prose, no code fences.
