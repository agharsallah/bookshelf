---
name: write-brief
description: Write the one-page book brief for a Bookshelf document from all of its chapter distillations — thesis in three sentences, five to seven load-bearing ideas with repeats across chapters collapsed, the argument's structure, what it changes about how you act, where it is weak or dated, and read-next pointers into the user's own shelf. Use for a book_brief (pipeline stage 6) or when the user asks for the brief of a document, e.g. `/write-brief okafor-queueing`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `okafor-queueing`.

1. Fetch the input — the exact JSON the batch runner would send, including its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/write-brief/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: agree on the thesis and the list of
   ideas before writing the rest; discuss the weaknesses honestly.
3. Write `{"skill": "write-brief", "document": "<slug>", "anchor": <the input's scope.anchor>, "input_hash": "<from the inputs response>", "output": <the JSON object>}`
   to `skills/.outbox/write-brief-<slug>.json`.
4. Import it; the server runs the same schema, anchor, grounding and length gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, word count).
<!-- interactive:end -->

# Write the book brief

## Role

You write the page a reader rereads a year later instead of the book. It has a **fixed shape**
so briefs are comparable across a shelf. You are the one stage that sees the whole book at
once: your input is every chapter distillation (`chapter_distillations: [{anchor, heading,
body}]`, each `body.blocks` already cited to source blocks), the theses of the other documents
on the user's shelf (`shelf: [{slug, title, authors, year, thesis}]`) and the shelf's concepts
(`existing_concepts`). Your particular job is to **collapse ideas the author repeats across
chapters** and to notice where the author circles back.

## Method

1. **Read every chapter distillation in order.** List the claims each one insists on
   (`important` callouts, opening paragraphs), its definitions and its warnings.
2. **Cluster.** Group claims that are the same idea in different chapters. Each cluster is one
   candidate idea, citing anchors from each chapter it appears in. Rank clusters by how much of
   the book depends on them.
3. **Write the six sections, in this order, with these keys and titles:**
   1. `thesis` — "Thesis". **Exactly one paragraph of exactly three spans, one sentence each:**
      (1) the claim, (2) why it holds — the core mechanism or evidence, (3) what follows from it.
   2. `ideas` — "Load-bearing ideas". **One `bullets` block with five to seven items**, most
      load-bearing first. Each item opens with a short `"mark": "strong"` span naming the idea,
      followed by one or two spans stating it. An idea that recurs cites every chapter it appears
      in and says so ("the author returns to this in the chapters on batch size and hidden queues").
   3. `structure` — "How the argument is built". A `steps` block of 3–6 moves (premise →
      mechanism → evidence → implication), or a `diagram` if the book's argument is itself a
      structure; at most three blocks.
   4. `changes` — "What it changes". Concrete changes in how a reader acts, as the book
      prescribes them: `bullets` or `steps`; an `antipattern` callout for the one habit the book
      most wants you to drop. At most three blocks.
   5. `weaknesses` — "Where it is weak or dated". See rule 6 below. `bullets`, `paragraph` or
      `caution` callouts; at most three blocks.
   6. `read_next` — "Read next". **`blocks` is always `[]`**; the pointers go in the top-level
      `read_next` list.
4. **`read_next`** (0–5 items): for each document in `shelf` that genuinely extends,
   challenges or applies this book's ideas, `{"slug": <its slug>, "reason": [spans]}`. The
   reason names the connection in one or two sentences, grounded in this book (cite the
   passage here that connects) and in the shelf item's `thesis`. Omit `anchor` — the shelf
   carries no anchors into other documents. An empty shelf or no real connection gives
   `"read_next": []`; a weak pointer is worse than none.
5. **Length:** one page — about 350–600 words in all spans, never more than 700.
6. **Weaknesses, honestly and grounded.** Allowed: (a) limits and caveats the author concedes;
   (b) where the book's evidence, as the distillations report it, is thin — one study, one
   company, anecdote in place of data; (c) tensions between chapters (cite both sides);
   (d) datedness visible in the text itself — the years of its data, the tools or practices it
   assumes. Phrase your judgement as judgement ("The case rests on a single team's data"), cite
   the passage you are judging, and never assert outside facts ("later research showed…") as
   if the book or the input contained them.
7. **Self-check:** section keys in order; thesis is three sentences; five to seven ideas; every
   span cited; every `read_next` slug appears in `shelf`.

## Hard rules

1. **Only the given input.** Everything comes from the chapter distillations; the only outside
   material allowed is the `shelf` entries, used solely in `read_next`. Never present outside
   knowledge as the book's claim.
2. **Every leaf span (`{text, cites}`) cites ≥ 1 anchor** that appears verbatim in the input —
   reuse the block anchors inside the distillations' spans (`ch03/s01/p004`). Cite a chapter
   anchor (`chapter_distillations[].anchor`) only for a claim about a chapter as a whole. Never
   construct, guess or shorten an anchor, and never cite another document's anchors.
3. **Cite the most specific anchor** that supports the span; a recurring idea cites one anchor
   per chapter it recurs in (up to five).
4. **Collapse repetition.** No idea appears twice across the brief's sections in the same words;
   `changes` states consequences for action, not the ideas again.
5. **`read_next` slugs must be existing `shelf` slugs**, never this document's own slug, never invented.
6. **Callout tones keep their meanings:** `important` = what the author insists on,
   `remember` = recall cold, `antipattern` = what the author warns against, `caution` = a limit
   or caveat, `insight` = a non-obvious connection, `contrast` = a distinction the author draws,
   `question` = an open question. Never use a tone to disguise your own opinion as the author's.
7. **Thin input** (one short distillation, or distillations that are mostly empty): still
   produce the fixed shape from what exists; where a section cannot be supported, write a single
   span `"The distillations do not support this section yet."` with `"cites": []` — the missing
   citation routes the brief to review. Never pad ideas with invented content: if fewer than
   five exist, list them and fill the remaining slots up to five with the uncited span
   `"No further load-bearing idea is supported by the distillations."`

## Output

One JSON object: `{"sections": [six {"key", "title", "blocks"} objects in the order thesis,
ideas, structure, changes, weaknesses, read_next], "read_next": [{"slug", "reason"}]}`.

## Example

Input (excerpt): `chapter_distillations` for `ch02` "Little's Law" (… "average items in a system = arrival rate × time inside" cites `ch02/s01/p001`; antipattern "starting more work to speed up delivery" cites `ch02/s01/p005`), `ch03` "Utilization Is a Trap" (important "beyond about 80% utilization waiting explodes" cites `ch03/s01/p004`), `ch05` "Batch Size" (… "smaller batches cut waiting for the same reason WIP limits do" cites `ch05/s02/p003`) …; `shelf` = `[{"slug": "meadows-systems", "title": "Thinking in Systems", "thesis": "Behaviour comes from structure: stocks, flows and feedback loops."}]`. Output (abridged — ideas and later sections shortened):

```json
{
  "sections": [
    {"key": "thesis", "title": "Thesis", "blocks": [{"type": "paragraph", "spans": [
      {"text": "Knowledge work is slow mostly because it waits, not because people work slowly.", "cites": ["ch01/s01/p002"]},
      {"text": "Queueing arithmetic makes waiting grow with work in progress and explode past about 80% utilization.", "cites": ["ch02/s01/p001", "ch03/s01/p004"]},
      {"text": "So the lever is limiting work in progress and keeping slack, not pushing people harder.", "cites": ["ch04/s01/p002", "ch03/s03/p002"]}]}]},
    {"key": "ideas", "title": "Load-bearing ideas", "blocks": [{"type": "bullets", "items": [
      [{"text": "Little's law. ", "cites": ["ch02/s01/p001"], "mark": "strong"}, {"text": "Average work in progress = throughput × time in system, so more WIP at the same throughput means longer waits; the author returns to it in the chapters on WIP limits and batch size.", "cites": ["ch02/s01/p005", "ch04/s01/p003", "ch05/s02/p003"]}],
      …]}]},
    …,
    {"key": "read_next", "title": "Read next", "blocks": []}
  ],
  "read_next": [
    {"slug": "meadows-systems", "reason": [{"text": "Treats the queue as a stock and WIP limits as a balancing loop — the structural view behind this book's flow arithmetic.", "cites": ["ch02/s01/p001", "ch04/s01/p002"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
