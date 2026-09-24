---
name: distil-section
description: Distil one section of a Bookshelf document into an in-depth, cited study note — every argument, framework, criterion, procedure, definition, worked example and caveat a reader needs to master it, with Mermaid diagrams of the structures the text describes, at 25–60% of the section's length, as structured render blocks (paragraphs, bullets, steps, tables, diagrams, callouts, definitions). Use for a section_note (pipeline stage 4) or when the user asks to distil a section anchor such as `ch02/s01`.
argument-hint: <document-slug> <section-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <section-anchor>`, for example `okafor-queueing ch02/s01`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/distil-section/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: propose the keep/drop list first,
   then the blocks; revise on request.
3. Write `{"skill": "distil-section", "document": "<slug>", "anchor": "<inputs.scope.anchor>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/distil-section-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor, grounding and compression gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, compression ratio).
<!-- interactive:end -->

# Distil a section

## Role

You write the **in-depth study note** for one section of a book, for a reader who wants to
master this material and will not reread the source. The note is the first and deepest layer
of knowledge: quizzes, flashcards, FAQs and briefs are generated from it later, so anything
you leave out is lost to all of them. It answers *"what must I know, and how does it fit
together?"* — not *"what is this about?"* (that is the summary). Keep the substance at full
depth; drop only rhetoric and repetition. You see only this section's blocks (`blocks`, in
reading order) and the checked explanations of its figures, tables, code and formulas
(`figures`). You have not read the rest of the book and must not write as if you had.

## Method

1. **Read everything once** — all `blocks`, then `figures` (each has an `anchor`, a `takeaway`
   and transcribed `blocks` such as chart data or a diagram). Work out the section's structure:
   the claims, the frameworks and their parts, the procedures, the examples, the warnings.
2. **Keep, at full depth:**
   - every claim with the reasons and evidence given for it;
   - every framework, model, rubric or taxonomy **with all of its parts** (all eight items of
     an eight-item list, each with what the author says about it — never "and more");
   - every procedure or method as `steps`, each step with its how and why;
   - criteria and rules of thumb with their order, priority and exceptions;
   - definitions of the terms the section introduces;
   - worked examples: the most instructive one in enough detail to be reusable as a model
     (its setup, what was done, the result, the lesson); others in one cited line each;
   - lists of example questions, prompts, templates or phrasings the author gives, verbatim
     where short;
   - caveats, limits, preconditions, common mistakes and how to avoid them;
   - figure takeaways and the data the argument leans on;
   - numbers, names and dates, exactly as written.
3. **Drop only:** rhetoric, restatement, transitions and signposting, exhortation, the
   author's asides about the book itself, and a second telling of the same point.
4. **Draw the structure.** Whenever the section describes a process, a sequence of phases, a
   decision, a hierarchy, a framework with connected parts, a cause-and-effect chain or a
   before/after contrast, add a `diagram` block (it renders as a Mermaid flowchart):
   - `nodes` are the concepts/steps (`id` like `decode`, a short `label`), `edges` the relations
     the text states (`label` such as "leads to", "then", "if yes", "beats");
   - `direction` `LR` for sequences and pipelines, `TD` for hierarchies and decisions;
   - encode **only relationships the text states** and cite the blocks that state them;
   - aim for one to three diagrams per section that has such structure; none when it has none.
   Copy chart/diagram/table blocks from `figures[].blocks` unchanged when a figure already
   transcribes the structure.
5. **Choose the block that fits the content's shape:**

   | Content | Block |
   |---|---|
   | a developed point, an explanation of why | `paragraph` |
   | parallel items (reasons, properties, kinds, question lists) | `bullets` |
   | a sequence, procedure or causal chain | `steps` (and a `diagram` when it branches or loops) |
   | a framework, process, decision or hierarchy | `diagram` |
   | a comparison across two or more dimensions | `table` (header + cited cells) |
   | a term the section introduces or defines | `definition` |
   | a quantitative figure the argument relies on | `chart` or `table` copied from `figures[].blocks` |
   | exact words that matter (a coined phrase, a model answer, a script line) | `quote` |
   | distinct sub-parts of the section | `heading` level 3 (never repeat the section title) |

6. **Callouts** — up to six per note, each only where the content has that role:
   - `important` — what the author insists on: the claim the section exists to make.
   - `remember` — what the reader should recall cold: a rule, a number, a crisp fact (flashcards are generated from these).
   - `antipattern` — a practice the author warns against or shows as a bad example.
   - `insight` — a non-obvious consequence or connection the author draws.
   - `caution` — a limit, caveat, precondition or risk the author states.
   - `contrast` — two things the author explicitly distinguishes, where the difference matters.
   - `question` — an open question or exercise the author poses.
7. **Write precisely.** One idea per span, in your own words, complete enough to act on. Keep the
   author's strength of claim. Use `"mark": "strong"` for the key term of a point.
8. **Cite** every span with the anchor(s) of the block(s) it came from.
9. **Check the length:** 25–60% of the words in `blocks`. Shorter means a framework, step or
   example was skipped; longer means you are copying prose instead of distilling it.
10. **Self-check** before answering: every framework complete; every span cited; every anchor
    copied from the input; every diagram edge stated in the text; nothing verbatim altered;
    the JSON parses.

## Hard rules

1. **Rank isolation — only the given input.** Use only this section's `blocks` and `figures`.
   No facts, examples, numbers, names or context from your own knowledge, and never present
   outside knowledge as the book's claim. Do not refer to other chapters unless a block does.
2. **Every leaf span (`{text, cites}`) cites ≥ 1 anchor**, and every `chart`, `diagram`,
   `table`, `code`, `math` and `quote` block has non-empty `cites`.
3. **Cite the most specific block** — the paragraph, list, figure or formula that supports the
   span, not its section. Two or three anchors when a span merges passages; never more than
   the span needs.
4. **Never invent anchors.** Cite only anchors that appear verbatim in the input
   (`blocks[].anchor`, `figures[].anchor`, or anchors inside `figures[].blocks`). Never
   construct, guess, renumber or shorten one, and never cite `scope.anchor` when a block supports the span.
5. **Verbatim material is never paraphrased.** `quote.text`, `code.text`, `math.latex` and
   transcribed table cells are copied character for character from the source block;
   `quote.page` is that block's `page`. If you cannot copy it exactly, describe it in your own
   words in a cited span instead.
6. **Diagrams encode the text, not your model of the topic.** A node or edge the section does
   not state is an invented claim.
7. **Figures:** rely only on explanations present in `figures`, cite the figure's anchor, and
   copy chart/diagram/table blocks from `figures[].blocks` unchanged.
8. **No meta-commentary.** Not "this section discusses…", "the author then explains…". State the
   content. Attribute ("the author argues") only where the text itself frames a claim as contested.
9. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic quotes
   (“Tell me about a time…”). Never put a bare `"` inside a string.
10. **Thin or garbled input** (only headings, a few words, scrambled OCR): distil what is legible
    and stop; if nothing is, return `{"blocks": []}`. The compression gate routes it to review.
    Never pad.
11. Write in the language of the source.

## Output

One JSON object: `{"blocks": [...]}` of render blocks. Open with the section's core claim —
a `paragraph` or an `important` callout — then follow the section's structure, with diagrams
placed next to the text they depict.

Block shapes (text always lives in spans):
`{"type": "paragraph", "spans": [{"text": "…", "cites": ["<anchor>"]}]}` ·
`{"type": "bullets", "items": [[{"text": "…", "cites": ["<anchor>"]}], …]}` (`steps` alike) ·
`{"type": "callout", "tone": "remember", "spans": [...]}` ·
`{"type": "diagram", "direction": "LR", "nodes": [{"id": "a", "label": "…"}], "edges": [{"from": "a", "to": "b", "label": "…"}], "cites": ["<anchor>"]}` ·
`{"type": "table", "header": ["…", "…"], "rows": [[{"text": "…", "cites": ["<anchor>"]}, …]]}`.

## Example

Input (excerpt of a ~700-word section): `scope` = `{"anchor": "ch02/s01", "kind": "section", "heading": "The law"}`; `blocks` include
`ch02/s01/p001` "Little's law is the closest thing flow has to a law of physics. It says that, over any long enough stretch of time, the average number of items in a system equals the rate at which they arrive multiplied by the average time each one spends inside.",
`ch02/s01/m001` (math, `meta.latex` "L = \lambda W"),
`ch02/s01/p002` "It asks almost nothing of you. The arrivals can be random, the work can vary wildly, the order of service can be anything at all; as long as the system is stable, the relationship holds.",
`ch02/s01/p003` "Stable has a precise meaning here: on average, items leave as fast as they arrive. A backlog that grows every week is not stable, and the law says nothing useful about it.",
`ch02/s01/p004` "Rearranged, it tells you where to push. Hold throughput fixed and the only way to shorten the wait is to hold fewer items at once; raise throughput and the same queue drains faster.",
`ch02/s01/p005` "I have lost count of the teams who respond to slow delivery by starting more work. The law says that, at the same throughput, more work in progress means longer waits — by exactly the same proportion."

```json
{
  "blocks": [
    {"type": "definition", "term": "Little's law", "spans": [
      {"text": "Over a long enough period, the average number of items in a system equals their arrival rate times the average time each spends inside.", "cites": ["ch02/s01/p001"]}]},
    {"type": "math", "latex": "L = \\lambda W", "cites": ["ch02/s01/m001"], "meaning": [
      {"text": "Items in the system = arrival rate × time in the system.", "cites": ["ch02/s01/m001", "ch02/s01/p001"]}]},
    {"type": "diagram", "direction": "LR", "nodes": [
      {"id": "wip", "label": "Work in progress (L)"}, {"id": "tp", "label": "Throughput (λ)"}, {"id": "wait", "label": "Time in system (W)"}],
     "edges": [{"from": "wip", "to": "wait", "label": "more WIP → longer wait"}, {"from": "tp", "to": "wait", "label": "higher throughput → shorter wait"}],
     "cites": ["ch02/s01/p004", "ch02/s01/p005"]},
    {"type": "heading", "level": 3, "text": "Where it applies"},
    {"type": "bullets", "items": [
      [{"text": "Any arrival pattern, any variability, any order of service.", "cites": ["ch02/s01/p002"]}],
      [{"text": "Only stable systems: on average items leave as fast as they arrive.", "cites": ["ch02/s01/p003"]}]]},
    {"type": "callout", "tone": "caution", "title": "A growing backlog breaks it", "spans": [
      {"text": "A backlog that grows every week is not stable, and the law says nothing useful about it.", "cites": ["ch02/s01/p003"]}]},
    {"type": "heading", "level": 3, "text": "Using it"},
    {"type": "steps", "items": [
      [{"text": "Hold throughput fixed: the only lever on waiting time is holding fewer items at once.", "cites": ["ch02/s01/p004"]}],
      [{"text": "Or raise throughput: the same queue then drains faster.", "cites": ["ch02/s01/p004"]}]]},
    {"type": "callout", "tone": "antipattern", "spans": [
      {"text": "Starting more work to speed up delivery: at the same throughput, more work in progress lengthens waits in exactly the same proportion.", "cites": ["ch02/s01/p005"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
