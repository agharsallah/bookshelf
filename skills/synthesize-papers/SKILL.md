---
name: synthesize-papers
description: Write a related-work style synthesis of a Bookshelf paper set — the question the papers share, how their approaches differ, where their results agree or conflict, what remains open — and one comparison table, citing every statement to the papers' own passages as `<slug>:<anchor>`. Use when the user asks to compare, review or synthesize several papers they have read, or when a paper set's synthesis job runs, e.g. `/synthesize-papers <set-id>`.
argument-hint: <set-id>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<set-id>`. This skill has no inputs endpoint and stores no artifact; the
backend runs it in the `synthesize_papers` job, and versions each synthesis per set.

1. Read the set: `curl -s "$BOOKSHELF_API/paper-sets/<set-id>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`), then each member's card:
   `curl -s "$BOOKSHELF_API/papers/<document-id>"`.
2. Work through the synthesis with the user using the method below.
3. To have a stored version written, queue the job:
   `curl -s -X POST "$BOOKSHELF_API/paper-sets/<set-id>/synthesis" -H "X-API-Key: $BOOKSHELF_API_KEY"`,
   then read it with `curl -s "$BOOKSHELF_API/paper-sets/<set-id>/synthesis"`.
<!-- interactive:end -->

# Synthesize a set of papers

## Role

You write the related-work section a careful researcher would write about exactly these
papers, for a reader who has read them. The input is `set` (its `name`) and `papers`, each
`{slug, title, authors, year, venue, card, claims, results, abstract}`: `card` is the
paper's approved dissection (TL;DR, question, contributions, method, setup, results,
limitations), `claims` its extracted claims, `results` its reported numbers. Every `cites`
in the input is already qualified, `<slug>:<anchor>`: those keys are the only passages you
may cite. `comparison` pivots every paper's results into rows (method, paper) × columns
(dataset, metric), each cell `{value, unit, cite}`, so shared benchmarks line up.

## Method

1. **Find the shared question** the papers answer, and say where each one stands on it.
2. **Group by approach, not by paper**: a paragraph per idea, naming which papers take it
   and how they differ. Use `heading` blocks (level 2 or 3) for the groups.
3. **Compare results only where they are comparable**: the same dataset and metric in
   `comparison`. Flag any comparison the setups undermine (different data, retrievers,
   budgets) in a `callout` (tone `caution` or `contrast`).
4. **Agreements and conflicts**: where claims support or contradict each other, say so and
   cite both sides.
5. **What is open**: the limitations and future work the papers state, joined up.
6. **The table**: one row per paper (first cell its title, cited to its card), 3–6
   columns you choose (approach, data, headline result, main limitation…), every cell cited.

## Hard rules

1. **Cite everything, with the input's keys only**: every span's `cites` holds one or more
   `<slug>:<anchor>` keys copied exactly from the input. Never a bare anchor, never a key
   the input does not contain.
2. **Every paper of the set is cited at least once.**
3. **Only the given input.** Nothing from what you know about these papers or the field
   elsewhere; no numbers that are not in `results`, `comparison` or the cards.
4. **Render contract** (with the `<slug>:` qualifiers removed): only `heading`,
   `paragraph`, `bullets`, `callout` and `quote` blocks in `blocks`; `table` is one
   `table` block (`header`, `rows` of spans, optional `caption`).
5. **Related-work register**: third person, past tense for what papers did, present for
   what they show; 400–1200 words in `blocks`.

## Output

One JSON object: `{"blocks": [render blocks], "table": {"type": "table", "caption"?: str,
"header": [str], "rows": [[span]]}}`, with every cite `<slug>:<anchor>`.

Output only the JSON object. No prose, no code fences.
