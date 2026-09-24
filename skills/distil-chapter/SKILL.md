---
name: distil-chapter
description: Distil one chapter of a Bookshelf document from its in-depth section notes into a single cited chapter study guide — a big-picture Mermaid diagram first, then every framework, procedure, criterion and worked example at full depth, ideas repeated across sections merged, and the author's insistences, must-remembers and warnings as callouts. Use for a chapter_distillation (pipeline stage 5) or when the user asks to distil a chapter anchor such as `ch03`.
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

You write the **chapter study guide**: the single structured document a reader returns to
instead of the chapter, at the depth needed to apply it. It answers *"what must I know from
this chapter, and how does it fit together?"*. Quizzes, flashcards, FAQs and the book brief
are generated from it later, so it must be complete. You work one rank above the source: your
input is the chapter's **in-depth section notes** (`section_notes: [{anchor, heading, body}]`,
where `body.blocks` are already-cited render blocks, diagrams included) plus the checked
figure, table, code and formula explanations inside the chapter (`figures`). You do not see
the source blocks, the other chapters or the rest of the book, and you must not write as if
you did.

## Method

1. **Read all section notes in order**, then `figures`. Work out the chapter's thesis and how
   the sections build it.
2. **Open with the big picture:** an `important` callout with the chapter's central claim, then
   a `diagram` that maps the chapter — its frameworks, phases or concepts and how they connect
   (`TD` for a hierarchy, `LR` for a process). Every node and edge must come from the section
   notes; cite the anchors that state them.
3. **Structure by argument, not by section.** Use `heading` level 2 for each major movement of
   the argument and level 3 for its parts. Merge thin sections into a neighbour's heading.
4. **Keep everything the section notes keep, at full depth:** every framework with all of its
   parts, every procedure as `steps`, criteria with their priorities and exceptions,
   definitions, comparisons (`table`), the model worked example(s), question lists and
   templates, caveats and pitfalls. Carry each section note's diagrams over unchanged, or merge
   two diagrams of the same structure into one; add a diagram wherever the chapter connects
   ideas across sections.
5. **Merge what repeats.** The same idea in several section notes becomes one statement citing
   the anchors from each (up to four). Keep the clearest formulation and the strongest example.
6. **Close with application:** a level-2 heading such as "Putting it into practice" with a
   `steps` checklist of what to do, drawn only from the notes' procedures and advice.
7. **Callouts** — up to ten in the whole guide, each tone with one meaning:
   - `important` — what the author insists on: the chapter's central claim(s).
   - `remember` — what the reader should recall cold: rules, key numbers, crisp facts (flashcards come from these).
   - `antipattern` — a practice the author warns against or shows as a bad example.
   - `insight` — a non-obvious consequence or connection the author draws across sections.
   - `caution` — a limit, caveat, precondition or risk the author states.
   - `contrast` — two things the author explicitly distinguishes, where the difference matters.
   - `question` — an open question or exercise the author poses.
8. **Carry the citations over.** Each span cites the anchors of the section-note spans it draws
   on — source block anchors (`ch03/s02/p014`), reused exactly.
9. **Length:** about 80–100% of the section notes' combined length: you are organising and
   deduplicating, not compressing again. The gate measures you against the chapter's source
   (20–60%).
10. **Self-check:** every framework complete; every span cited with anchors copied from the
    input; every diagram edge stated in a note; verbatim blocks unchanged; the JSON parses.

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
6. **Diagrams encode the notes, not your model of the topic.** A node or edge no note states is
   an invented claim.
7. **No meta-commentary** ("this chapter covers…", "section 2 explains…"). State the content.
8. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic quotes
   (“Tell me about a time…”). Never put a bare `"` inside a string.
9. **Thin input:** if the section notes are nearly empty, distil what is there and stop; if
   nothing is usable, return `{"blocks": []}` for review. Never pad.
10. Write in the language of the source.

## Output

One JSON object: `{"blocks": [...]}` of render blocks: the central claim, the big-picture
diagram, the argument under level-2 headings, then "Putting it into practice".

Block shapes (text always lives in spans):
`{"type": "paragraph", "spans": [{"text": "…", "cites": ["<anchor>"]}]}` ·
`{"type": "bullets", "items": [[{"text": "…", "cites": ["<anchor>"]}], …]}` (`steps` alike) ·
`{"type": "callout", "tone": "remember", "spans": [...]}` ·
`{"type": "diagram", "direction": "TD", "nodes": [{"id": "a", "label": "…"}], "edges": [{"from": "a", "to": "b", "label": "…"}], "cites": ["<anchor>"]}` ·
`{"type": "table", "header": ["…", "…"], "rows": [[{"text": "…", "cites": ["<anchor>"]}, …]]}`.

## Example

Input (excerpt): `scope` = `{"anchor": "ch03", "kind": "chapter", "heading": "Utilization Is a Trap"}`; `section_notes` include
`{"anchor": "ch03/s01", "heading": "The hockey stick", "body": {"blocks": [{"type": "paragraph", "spans": [{"text": "Past about 80% utilization, waiting grows faster than load: at 90% an item waits about nine times its service time.", "cites": ["ch03/s01/p004", "ch03/s01/f001"]}]}, …]}}`,
`{"anchor": "ch03/s02", "heading": "Variability", …"Waiting scales with both utilization and variability; either alone is survivable." cites ["ch03/s02/p003"]…}`,
`{"anchor": "ch03/s03", "heading": "Slack as a feature", …"Planning to 100% capacity guarantees queues, because unplanned work has nowhere to go." cites ["ch03/s03/p002"]… "Keep 15–20% of capacity unallocated." cites ["ch03/s03/p006"]… "Review utilization weekly and cut intake when it passes 80%." cites ["ch03/s03/p007"]…}`.

```json
{
  "blocks": [
    {"type": "callout", "tone": "important", "spans": [
      {"text": "Busyness is not productivity: beyond about 80% utilization, each extra percent of load buys a disproportionate amount of waiting.", "cites": ["ch03/s01/p004", "ch03/s01/f001"]}]},
    {"type": "diagram", "direction": "LR", "nodes": [
      {"id": "util", "label": "High utilization"}, {"id": "var", "label": "Variability"}, {"id": "wait", "label": "Waiting explodes"}, {"id": "slack", "label": "15–20% slack"}],
     "edges": [{"from": "util", "to": "wait", "label": "past ~80%"}, {"from": "var", "to": "wait", "label": "multiplies"}, {"from": "slack", "to": "util", "label": "caps"}],
     "cites": ["ch03/s01/p004", "ch03/s02/p003", "ch03/s03/p006"]},
    {"type": "heading", "level": 2, "text": "Why waiting explodes"},
    {"type": "paragraph", "spans": [
      {"text": "Waiting scales with utilization and variability together; either alone is survivable. ", "cites": ["ch03/s02/p003"]},
      {"text": "At 90% utilization an item waits about nine times its service time.", "cites": ["ch03/s01/p004", "ch03/s01/f001"]}]},
    {"type": "heading", "level": 2, "text": "Slack as capacity"},
    {"type": "callout", "tone": "antipattern", "spans": [
      {"text": "Planning to 100% capacity: unplanned work has nowhere to go, so queues are guaranteed.", "cites": ["ch03/s03/p002"]}]},
    {"type": "callout", "tone": "remember", "spans": [
      {"text": "Keep 15–20% of capacity unallocated.", "cites": ["ch03/s03/p006"]}]},
    {"type": "heading", "level": 2, "text": "Putting it into practice"},
    {"type": "steps", "items": [
      [{"text": "Leave 15–20% of capacity unallocated when planning.", "cites": ["ch03/s03/p006"]}],
      [{"text": "Review utilization weekly and cut intake once it passes 80%.", "cites": ["ch03/s03/p007"]}]]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
