---
name: write-guide
description: Write the in-depth, visual book guide for a Bookshelf document from all of its chapter distillations — the whole argument end to end, a big-picture diagram of the book, a chapter-by-chapter journey with each chapter's role, the themes the author returns to, the numbers worth remembering, every core framework at depth with diagrams, tables and charts, and the book as a playbook. Use for a book_guide or when the user asks for a deep overview, study guide or visual summary of a whole document, e.g. `/write-guide okafor-queueing`. For the fixed one-page brief, use write-brief instead.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `okafor-queueing`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/write-guide/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: agree on the big-picture map, the
   chapter roles and the themes before writing the deep dive.
3. Write `{"skill": "write-guide", "document": "<slug>", "anchor": <inputs.scope.anchor>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/write-guide-<slug>.json`.
4. Import it; the server runs the same schema, anchor, grounding and length gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, word count).
<!-- interactive:end -->

# Write the book guide

## Role

You write the **book guide**: the one document that makes the whole book easy to understand
at a glance and then at depth. The one-page brief (a separate artifact) says *what the book
claims*; the guide shows *how the whole book fits together and how to use it*. A reader should
be able to grasp the book's shape in two minutes from the visuals, and learn its core ideas
properly from the deep dive.

Your input is every chapter distillation (`chapter_distillations: [{anchor, heading, body}]`,
each `body.blocks` already cited to source blocks, with diagrams, tables and charts), the other
documents on the shelf (`shelf`) and the shelf's concepts (`existing_concepts`). You are the
stage that sees the whole book at once: your particular job is to **connect** — show how the
chapters build on each other, merge frameworks the author develops across several chapters
into one complete statement, and notice what the author keeps returning to.

The guide page draws your structured lists as visuals, so they must be exact:

- `journey` becomes a chapter-by-chapter timeline, each chapter coloured by its **role**, its
  bar sized by the chapter's reading time;
- `themes` becomes a heatmap of *theme × chapter*, computed from **the chapters your theme
  spans cite** — so a theme must cite the passages in every chapter where it appears;
- `numbers` becomes a row of stat tiles.

## Method

1. **Read every chapter distillation in order.** For each chapter note its central claim,
   what it contributes to the book's argument, its frameworks, procedures, key numbers and
   warnings, and which earlier ideas it builds on.
2. **Classify each chapter's role** — exactly one of:
   - `setup` — frames the problem, the stakes or the context;
   - `concept` — introduces a core idea, model or vocabulary;
   - `method` — gives a procedure, technique or how-to;
   - `evidence` — presents data, studies or cases that support the argument;
   - `application` — applies the ideas to a situation, role or domain;
   - `synthesis` — ties the book together, concludes or looks ahead.
   Pick by what the chapter mostly *does*; a book normally uses several roles.
3. **Find the themes.** List the ideas the author returns to in more than one chapter. Rank by
   how many chapters depend on them. Keep the 3–8 strongest.
4. **Write the four sections, in this order, with these keys and titles:**
   1. `overview` — "The book in brief". The whole argument end to end in **3–6 paragraphs
      (250–500 words)**: the problem, the core idea, how the book develops it chapter by
      chapter (group chapters by movement, not one sentence each), and where it lands. Open
      with an `important` callout stating the book's central claim in one or two sentences.
      A closing `bullets` block of "what you will be able to do" is allowed.
   2. `map` — "The big picture". **First block: a `diagram`** of the whole book — its core
      concepts and frameworks and how they connect (`TD` for a hierarchy of ideas, `LR` for a
      causal chain or process). 6–18 nodes; label edges with the relation ("causes", "limits",
      "is measured by", "part of"). Every node and edge must be stated in a distillation; cite
      the anchors that state them. Optionally follow with one short `paragraph` on how to read
      the map, or a `table` comparing the book's main frameworks side by side.
   3. `deep_dive` — "The core ideas in depth". The substance, **at full depth**: one level-2
      `heading` per core idea or framework (usually 4–10), level 3 for its parts. For each:
      what it is, why it holds (the mechanism or evidence), how to apply it, and its limits.
      Use the richest block for the job:
      - a `diagram` for any structure, process, cycle or causal chain — **aim for one diagram
        per core idea** where the distillations state a structure; merge the chapter
        distillations' diagrams of the same framework into one complete diagram;
      - a `table` for comparisons, options, criteria and "X vs Y";
      - a `chart` only when the distillations carry the data (a transcribed chart or table):
        copy the numbers exactly, never estimate or invent a series;
      - `steps` for procedures; `definition` for the terms the idea rests on;
      - callouts, each tone with one meaning: `important` = what the author insists on,
        `remember` = recall cold, `antipattern` = what the author warns against, `caution` =
        a limit or precondition, `insight` = a non-obvious connection across chapters,
        `contrast` = a distinction the author draws, `question` = an open question the
        author poses. Up to fifteen in the deep dive.
      Where an idea recurs across chapters, say so and cite each chapter ("developed first
      in the chapter on X, extended in Y").
   4. `practice` — "Putting the book to work". One `steps` block: the book's advice as one
      integrated playbook, in the order a reader would act (8–15 steps), drawn only from the
      distillations' procedures and advice. Then an `antipattern` callout for the habits the
      book most wants you to drop. A `table` of "situation → what the book says to do" is
      allowed.
5. **`journey`** — **one entry per item of `chapter_distillations`, in the same order**:
   `{"anchor": <that item's anchor>, "role": <role>, "takeaway": [spans]}`. The takeaway is
   one or two sentences: what the chapter contributes to the book's argument (not a summary
   of its contents), citing the passages that state it.
6. **`themes`** (3–8) — `{"name": "<2–5 words>", "spans": [...]}`. The spans state the idea
   and how it develops, and **cite at least one anchor in every chapter where the theme
   appears** (up to six spans, up to four cites each). A theme cited in only one chapter is
   not a theme — move it to the deep dive.
7. **`numbers`** (0–8) — the figures the book wants remembered: thresholds, results,
   proportions, counts of a framework's parts. `{"value": "80%", "label": [spans]}`: `value`
   is the number as the book gives it, at most 24 characters ("~9×", "31 → 10 days", "4
   stages"); the label says what it measures and cites it. A book with no memorable numbers
   gives `"numbers": []`.
8. **Length:** about 2,000–4,500 words in all spans, never more than 6,000. Spend them in
   the deep dive.
9. **Self-check:** section keys in order; `map` opens with a diagram; `journey` has exactly
   one entry per chapter distillation, in order, with its exact anchor; every theme cites two
   or more chapters; every number appears in a distillation; every span cited; the JSON
   parses.

## Hard rules

1. **Only the given input.** Everything comes from the chapter distillations. No facts,
   examples, numbers or names from your own knowledge; never present outside knowledge as the
   book's claim. The `shelf` may be named in an `insight` callout only when a distillation
   itself invites the comparison — otherwise leave it out.
2. **Every leaf span (`{text, cites}`) cites ≥ 1 anchor** that appears verbatim in the input,
   and every `chart`, `diagram`, `table`, `code`, `math` and `quote` block has non-empty
   `cites`. Reuse the block anchors inside the distillations' spans (`ch03/s01/p004`). Cite a
   chapter anchor (`chapter_distillations[].anchor`) only for a claim about a chapter as a
   whole. Never construct, guess, renumber or shorten an anchor.
3. **Cite the most specific anchor** that supports the span; a recurring idea cites one anchor
   per chapter it recurs in (up to five).
4. **Diagrams and charts encode the distillations, not your model of the topic.** A node,
   edge or data point no distillation states is an invented claim.
5. **Verbatim material is never paraphrased.** `quote`, `code`, `math` and transcribed
   `chart`/`table` blocks are copied from the distillation exactly, including their `cites`.
6. **Connect, don't repeat.** The overview tells the story; the deep dive teaches the ideas;
   the practice section says what to do. The same sentence never appears in two sections.
7. **No meta-commentary** ("this guide covers…", "chapter 3 discusses…"). State the content:
   "Waiting grows with utilization" — not "The author discusses utilization".
8. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic
   quotes. Never put a bare `"` inside a string.
9. **Thin input** (one short distillation, or mostly empty ones): produce the fixed shape from
   what exists and stop — a shorter deep dive, fewer themes (still at least three, citing what
   exists), `"numbers": []`. Where a required part cannot be supported, write the single span
   `"The distillations do not support this yet."` with `"cites": []`; the missing citation
   routes the guide to review. Never pad.
10. Write in the language of the source.

## Output

One JSON object:
`{"sections": [four {"key", "title", "blocks"} objects in the order overview, map, deep_dive, practice], "journey": [{"anchor", "role", "takeaway"}], "themes": [{"name", "spans"}], "numbers": [{"value", "label"}]}`.

Block shapes (text always lives in spans):
`{"type": "paragraph", "spans": [{"text": "…", "cites": ["<anchor>"]}]}` ·
`{"type": "bullets", "items": [[{"text": "…", "cites": ["<anchor>"]}], …]}` (`steps` alike) ·
`{"type": "heading", "level": 2, "text": "…"}` ·
`{"type": "callout", "tone": "insight", "spans": [...]}` ·
`{"type": "definition", "term": "…", "spans": [...]}` ·
`{"type": "diagram", "direction": "LR", "nodes": [{"id": "a", "label": "…"}], "edges": [{"from": "a", "to": "b", "label": "…"}], "cites": ["<anchor>"]}` ·
`{"type": "table", "header": ["…", "…"], "rows": [[{"text": "…", "cites": ["<anchor>"]}, …]]}` ·
`{"type": "chart", "kind": "line", "title": "…", "x": {"label": "…", "values": [50, 70, 90]}, "y": {"label": "…"}, "series": [{"name": "…", "values": [1, 2.3, 9]}], "cites": ["<anchor>"]}`.

## Example

Input (excerpt): `chapter_distillations` for `ch01` "Why Work Waits" (important "delivery time is mostly waiting" cites `ch01/s01/p002`), `ch02` "Little's Law" ("average items in a system = arrival rate × time inside" cites `ch02/s01/p001`; antipattern "starting more work to speed up delivery" cites `ch02/s01/p005`), `ch03` "Utilization Is a Trap" (chart of waiting against utilization cites `ch03/s01/f001`; "beyond about 80% utilization waiting explodes" cites `ch03/s01/p004`), `ch04` "Limiting Work in Progress" (table of cycle time before/after cites `ch04/s02/t001`) …. Output (abridged — the deep dive shows one idea of several, and later journey entries are cut):

```json
{
  "sections": [
    {"key": "overview", "title": "The book in brief", "blocks": [
      {"type": "callout", "tone": "important", "spans": [
        {"text": "Knowledge work is slow because it waits, and the waiting is governed by how much work is in progress and how busy people are.", "cites": ["ch01/s01/p002", "ch02/s01/p001", "ch03/s01/p004"]}]},
      {"type": "paragraph", "spans": [
        {"text": "The book starts from a measurement: most of an item's delivery time is spent waiting, not being worked on. ", "cites": ["ch01/s01/p002"]},
        {"text": "It then explains the waiting with two pieces of queueing arithmetic — Little's law and the utilization curve — before showing, with team data, that limiting work in progress cuts cycle time without costing throughput.", "cites": ["ch02/s01/p001", "ch03/s01/p004", "ch04/s02/t001"]}]}]},
    {"key": "map", "title": "The big picture", "blocks": [
      {"type": "diagram", "direction": "LR", "nodes": [
        {"id": "wip", "label": "Work in progress"}, {"id": "util", "label": "Utilization"}, {"id": "wait", "label": "Waiting time"},
        {"id": "cycle", "label": "Cycle time"}, {"id": "limit", "label": "WIP limit"}, {"id": "slack", "label": "15–20% slack"}],
       "edges": [
        {"from": "wip", "to": "wait", "label": "Little's law"}, {"from": "util", "to": "wait", "label": "explodes past ~80%"},
        {"from": "wait", "to": "cycle", "label": "dominates"}, {"from": "limit", "to": "wip", "label": "caps"}, {"from": "slack", "to": "util", "label": "caps"}],
       "cites": ["ch02/s01/p001", "ch03/s01/p004", "ch01/s01/p002", "ch04/s01/p002", "ch03/s03/p006"]}]},
    {"key": "deep_dive", "title": "The core ideas in depth", "blocks": [
      {"type": "heading", "level": 2, "text": "The utilization curve"},
      {"type": "paragraph", "spans": [
        {"text": "Waiting stays modest up to about 70% utilization and then rises steeply: at 90% an item waits about nine times its service time.", "cites": ["ch03/s01/p004", "ch03/s01/f001"]}]},
      {"type": "chart", "kind": "line", "title": "Waiting time against utilization", "x": {"label": "Utilization (%)", "values": [50, 70, 80, 90, 95]},
       "y": {"label": "Wait (× service time)"}, "series": [{"name": "Wait", "values": [1, 2.3, 4, 9, 19]}], "cites": ["ch03/s01/f001"]},
      {"type": "callout", "tone": "remember", "spans": [{"text": "Keep 15–20% of capacity unallocated.", "cites": ["ch03/s03/p006"]}]},
      …]},
    {"key": "practice", "title": "Putting the book to work", "blocks": [
      {"type": "steps", "items": [
        [{"text": "Make every queue visible, including approvals and hand-offs.", "cites": ["ch06/s02/p004"]}],
        [{"text": "Set an explicit WIP limit and stop starting before you start finishing.", "cites": ["ch04/s01/p002"]}],
        …]},
      {"type": "callout", "tone": "antipattern", "spans": [{"text": "Responding to slow delivery by starting more work.", "cites": ["ch02/s01/p005"]}]}]}
  ],
  "journey": [
    {"anchor": "ch01", "role": "setup", "takeaway": [{"text": "Establishes that delivery time is mostly waiting time — the fact the rest of the book explains.", "cites": ["ch01/s01/p002"]}]},
    {"anchor": "ch02", "role": "concept", "takeaway": [{"text": "Supplies the first mechanism: at fixed throughput, more work in progress means longer waits.", "cites": ["ch02/s01/p001"]}]},
    {"anchor": "ch03", "role": "concept", "takeaway": [{"text": "Adds the second: past about 80% utilization, waiting explodes.", "cites": ["ch03/s01/p004"]}]},
    {"anchor": "ch04", "role": "evidence", "takeaway": [{"text": "Shows WIP limits cutting cycle time from 31 to about 10 days with flat throughput.", "cites": ["ch04/s02/t001"]}]},
    …
  ],
  "themes": [
    {"name": "Waiting, not working", "spans": [
      {"text": "Delivery time is dominated by waiting, first measured in the opening chapter ", "cites": ["ch01/s01/p002"]},
      {"text": "and later traced to approvals and hand-offs nobody measures.", "cites": ["ch06/s01/p001"]}]},
    {"name": "Less in progress, more done", "spans": [
      {"text": "Little's law makes WIP the lever, ", "cites": ["ch02/s01/p001"]},
      {"text": "WIP limits prove it on real teams, ", "cites": ["ch04/s02/t001"]},
      {"text": "and small batches work for the same reason.", "cites": ["ch05/s02/p003"]}]},
    …
  ],
  "numbers": [
    {"value": "~80%", "label": [{"text": "Utilization past which waiting explodes", "cites": ["ch03/s01/p004"]}]},
    {"value": "31 → 10 days", "label": [{"text": "Average cycle time before and after WIP limits", "cites": ["ch04/s02/t001"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
