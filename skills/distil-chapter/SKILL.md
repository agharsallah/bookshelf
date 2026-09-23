---
name: distil-chapter
description: Distil one chapter of a Bookshelf document from its section notes into a single cited chapter distillation — the chapter's argument in order, ideas repeated across sections merged, definitions and figure data kept, and the author's insistences, must-remembers and warnings as important / remember / antipattern callouts. Use for a chapter_distillation (pipeline stage 5) or when the user asks to distil a chapter anchor such as `ch03`.
argument-hint: <document-slug> <chapter-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <chapter-anchor>`, for example `okafor-queueing ch03`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/distil-chapter/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: first the chapter's argument as a
   one-line outline, then the blocks; revise on request.
3. Write `{"skill": "distil-chapter", "document": "<slug>", "anchor": "<inputs.scope.anchor>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/distil-chapter-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor, grounding and compression gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, compression ratio).
<!-- interactive:end -->

# Distil a chapter

## Role

You write the chapter distillation: the single structured page a reader returns to instead
of the chapter. It answers *"what must I retain from this chapter?"*. You work one rank above
the source: your input is the chapter's **section notes** (`section_notes: [{anchor, heading,
body}]`, where `body.blocks` are already-cited render blocks) plus the checked figure, table,
code and formula explanations inside the chapter (`figures`). You do not see the source
blocks, the other chapters or the rest of the book, and you must not write as if you did.

## Method

1. **Read all section notes in order**, then `figures`. Write down (for yourself) the
   chapter's argument in one line: the thesis and how the sections build it.
2. **Structure by argument, not by section.** Use `heading` level 2 for each major movement of
   the argument. Merge thin sections into their neighbour's heading; never split a section
   into more headings than it has ideas. Do not reproduce section headings mechanically.
3. **Merge what repeats.** The same idea in several section notes becomes one statement citing
   the anchors from each (up to four). Keep the clearest formulation and the strongest example.
4. **Promote the chapter-level core into callouts** — each tone has one meaning:
   - `important` — what the author insists on: the chapter's central claim(s). Usually one, near the top.
   - `remember` — what the reader should recall cold: rules, key numbers, crisp facts (flashcards come from these).
   - `antipattern` — a practice the author warns against or shows as a bad example.
   - `insight` — a non-obvious consequence or connection the author draws across sections.
   - `caution` — a limit, caveat, precondition or risk the author states.
   - `contrast` — two things the author explicitly distinguishes, where the difference matters.
   - `question` — an open question or exercise the author poses.
   Use at most six callouts in the whole distillation; a callout that is not earned is noise.
5. **Keep:** arguments and their reasons, mechanisms (`steps`), every `definition` block (merge
   duplicates), comparisons (`table`), figure data and diagrams the argument relies on
   (`chart` / `diagram` / `table` copied unchanged from a section note or `figures[].blocks`),
   quotes and formulas the section notes kept, caveats. **Drop:** section-level scaffolding,
   duplicate examples, local detail that no later idea depends on, restatement.
6. **Carry the citations over.** Each span you write cites the anchors of the section-note
   spans it draws on — these are source block anchors (`ch03/s02/p014`), so reuse them exactly.
7. **Length:** about 70–100% of the section notes' combined length. You are merging and
   deduplicating, not compressing a second time; the gate measures you against the chapter's
   source (10–25%), just as it measured the section notes.
8. **Self-check:** every span cited with anchors copied from the input; no claim missing from
   the section notes or `figures`; verbatim blocks unchanged; callout tones used by meaning.

## Hard rules

1. **Rank isolation — only the given input.** Only the section notes and `figures`. No facts,
   examples, numbers or names from your own knowledge, no references to other chapters unless a
   section note makes them, and never present outside knowledge as the book's claim.
2. **Every leaf span (`{text, cites}`) cites ≥ 1 anchor**, and every `chart`, `diagram`,
   `table`, `code`, `math` and `quote` block has non-empty `cites`.
3. **Cite the most specific anchor available** — the block anchors inside the section notes'
   spans. Cite a section anchor (`section_notes[].anchor`) only for a claim about the section as
   a whole, never when a block anchor supports the span.
4. **Never invent anchors.** Cite only anchors that appear verbatim in the input. Never
   construct, guess, renumber or shorten one.
5. **Verbatim material is never paraphrased.** `quote`, `code`, `math` and transcribed table or
   chart blocks are copied from the section note or figure exactly, including their `cites` and
   `page`. If you shorten, describe in a cited span instead of editing the verbatim block.
6. **No meta-commentary** ("this chapter covers…", "section 2 explains…"). State the content.
7. **Thin input:** if the section notes are nearly empty, distil what is there and stop; if
   nothing is usable, return `{"blocks": []}` for review. Never pad.
8. Write in the language of the source.

## Output

One JSON object: `{"blocks": [...]}` of render blocks, opening with the chapter's central
claim (an `important` callout or a `paragraph`), then the argument under level-2 headings.

## Example

Input (excerpt): `scope` = `{"anchor": "ch03", "kind": "chapter", "heading": "Utilization Is a Trap"}`; `section_notes` include
`{"anchor": "ch03/s01", "heading": "The hockey stick", "body": {"blocks": [{"type": "paragraph", "spans": [{"text": "Past about 80% utilization, waiting grows faster than load: at 90% an item waits about nine times its service time.", "cites": ["ch03/s01/p004", "ch03/s01/f001"]}]}, …]}}`,
`{"anchor": "ch03/s02", "heading": "Variability", …"Waiting scales with both utilization and variability; either alone is survivable." cites ["ch03/s02/p003"]…}`,
`{"anchor": "ch03/s03", "heading": "Slack as a feature", …"Planning to 100% capacity guarantees queues, because unplanned work has nowhere to go." cites ["ch03/s03/p002"]… "Keep 15–20% of capacity unallocated." cites ["ch03/s03/p006"]…}`.

```json
{
  "blocks": [
    {"type": "callout", "tone": "important", "spans": [
      {"text": "Busyness is not productivity: beyond about 80% utilization, each extra percent of load buys a disproportionate amount of waiting.", "cites": ["ch03/s01/p004", "ch03/s01/f001"]}]},
    {"type": "heading", "level": 2, "text": "Why waiting explodes"},
    {"type": "paragraph", "spans": [
      {"text": "Waiting scales with utilization and variability together; ", "cites": ["ch03/s02/p003"]},
      {"text": "at 90% utilization an item waits about nine times its service time.", "cites": ["ch03/s01/p004", "ch03/s01/f001"]}]},
    {"type": "heading", "level": 2, "text": "Slack as capacity"},
    {"type": "callout", "tone": "antipattern", "spans": [
      {"text": "Planning to 100% capacity: unplanned work has nowhere to go, so queues are guaranteed.", "cites": ["ch03/s03/p002"]}]},
    {"type": "callout", "tone": "remember", "spans": [
      {"text": "Keep 15–20% of capacity unallocated.", "cites": ["ch03/s03/p006"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
