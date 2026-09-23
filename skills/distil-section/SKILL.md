---
name: distil-section
description: Distil one section of a Bookshelf document into a cited section note — the arguments, mechanisms, definitions, weight-bearing examples, caveats and figure takeaways a reader must retain, at 10–25% of the section's length, as structured render blocks (paragraphs, bullets, steps, tables, callouts, definitions). Use for a section_note (pipeline stage 4) or when the user asks to distil a section anchor such as `ch02/s01`.
argument-hint: <document-slug> <section-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <section-anchor>`, for example `okafor-queueing ch02/s01`.

1. Fetch the input — the exact JSON the batch runner would send, including its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/distil-section/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: propose the keep/drop list first,
   then the blocks; revise on request.
3. Write `{"skill": "distil-section", "document": "<slug>", "anchor": "<the input's scope.anchor>", "input_hash": "<from the inputs response>", "output": <the JSON object>}`
   to `skills/.outbox/distil-section-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor, grounding and compression gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, compression ratio).
<!-- interactive:end -->

# Distil a section

## Role

You distil one section of a book for a reader who will not reread it. A distillation answers
*"what must I retain from this?"* — not *"what is this about?"* (that is the summary). It is
the territory compressed: the arguments, mechanisms and definitions survive; the rhetoric
does not. You see only this section's blocks (`blocks`, in reading order) and the checked
explanations of its figures, tables, code and formulas (`figures`). You have not read the
rest of the book and must not write as if you had.

## Method

1. **Read everything once** — all `blocks`, then `figures` (each has an `anchor`, a `takeaway`
   and transcribed `blocks` such as chart data or a diagram). Decide what job the section does
   in the argument: makes a claim, explains a mechanism, defines terms, gives evidence, raises
   an objection.
2. **Keep** (in this order of priority):
   - the claims and the reasons given for them;
   - mechanisms — how and why something works, as `steps` when there is a sequence or causal chain;
   - definitions of terms the section introduces;
   - examples that carry weight (the argument is weaker without them) — the single most concrete one per claim;
   - caveats, limits, preconditions the author states;
   - figure takeaways and the data the argument leans on;
   - numbers, names and dates the argument depends on, exactly as written.
3. **Drop:** rhetoric, restatement, transitions and signposting ("in this section we will…"),
   anecdotes that only illustrate a point already made, the author's asides about the book
   itself, exhortation, and any second or third example of the same point.
4. **Choose the block that fits the content's shape:**

   | Content | Block |
   |---|---|
   | a developed point | `paragraph` |
   | parallel items (reasons, properties, kinds) | `bullets` |
   | a sequence, procedure or causal chain | `steps` |
   | a comparison across two or more dimensions | `table` (header + cited cells) |
   | a term the section introduces or defines | `definition` |
   | a quantitative figure the argument relies on | `chart` or `table` copied from `figures[].blocks` |
   | a flow, loop or structure in a figure | `diagram` copied from `figures[].blocks` |
   | exact words that matter (a coined phrase, a carefully worded definition) | `quote` |
   | a listing or formula that carries the argument | `code` / `math`, verbatim — otherwise a cited span that names it |
   | distinct sub-parts of a long section | `heading` level 3 (never repeat the section title) |

5. **Callouts** — at most three per section note, and only when the content genuinely has
   that role. Each tone has one meaning:
   - `important` — what the author insists on: the claim the section exists to make.
   - `remember` — what the reader should recall cold: a rule, a number, a crisp fact (flashcards are generated from these).
   - `antipattern` — a practice the author warns against or shows as a bad example.
   - `insight` — a non-obvious consequence or connection the author draws.
   - `caution` — a limit, caveat, precondition or risk the author states.
   - `contrast` — two things the author explicitly distinguishes, where the difference matters.
   - `question` — an open question or exercise the author poses.
6. **Write tight.** One idea per span, stated plainly in your own words. Keep the author's
   strength of claim: no hedges the author did not use, no certainty the author did not claim.
   Use `"mark": "strong"` for the key term of a point, `"mark": "code"` for identifiers.
7. **Cite** every span with the anchor(s) of the block(s) it came from.
8. **Check the length:** 10–25% of the words in `blocks`. Longer means you are copying or
   keeping duplicate examples; shorter means you skipped an argument.
9. **Self-check** before answering: every span cited; every anchor copied from the input; no
   claim that is not in the input; nothing verbatim altered.

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
6. **Figures:** rely only on explanations present in `figures`, cite the figure's anchor, and
   copy chart/diagram/table blocks from `figures[].blocks` unchanged. A figure block in
   `blocks` with no entry in `figures` may be mentioned only as far as its caption goes.
7. **No meta-commentary.** Not "this section discusses…", "the author then explains…". State the
   content. Attribute ("the author argues") only where the text itself frames a claim as contested.
8. **Thin or garbled input** (only headings, a few words, scrambled OCR): distil what is legible
   and stop; if nothing is, return `{"blocks": []}`. The compression gate routes it to review.
   Never pad.
9. Write in the language of the source.

## Output

One JSON object: `{"blocks": [...]}` of render blocks. Open with the section's core claim —
a `paragraph` or an `important` callout — then follow the argument's order.

## Example

Input (excerpt of a ~700-word section): `scope` = `{"anchor": "ch02/s01", "kind": "section", "heading": "The law"}`; `blocks` include
`ch02/s01/p001` "Little's law is the closest thing flow has to a law of physics. It says that, over any long enough stretch of time, the average number of items in a system equals the rate at which they arrive multiplied by the average time each one spends inside.",
`ch02/s01/m001` (math, `meta.latex` "L = \lambda W"),
`ch02/s01/p002` "It asks almost nothing of you. The arrivals can be random, the work can vary wildly, the order of service can be anything at all; as long as the system is stable, the relationship holds.",
`ch02/s01/p003` "Stable has a precise meaning here: on average, items leave as fast as they arrive. A backlog that grows every week is not stable, and the law says nothing useful about it.",
`ch02/s01/p005` "I have lost count of the teams who respond to slow delivery by starting more work. The law says that, at the same throughput, more work in progress means longer waits — by exactly the same proportion."

```json
{
  "blocks": [
    {"type": "definition", "term": "Little's law", "spans": [
      {"text": "Over a long enough period, the average number of items in a system equals their arrival rate times the average time each spends inside.", "cites": ["ch02/s01/p001"]}]},
    {"type": "math", "latex": "L = \\lambda W", "cites": ["ch02/s01/m001"], "meaning": [
      {"text": "Items in the system = arrival rate × time in the system.", "cites": ["ch02/s01/m001", "ch02/s01/p001"]}]},
    {"type": "callout", "tone": "caution", "title": "Only for stable systems", "spans": [
      {"text": "It holds whatever the arrival pattern, variability or order of service, ", "cites": ["ch02/s01/p002"]},
      {"text": "but only while items leave as fast as they arrive; a backlog that grows every week breaks it.", "cites": ["ch02/s01/p003"]}]},
    {"type": "callout", "tone": "antipattern", "spans": [
      {"text": "Starting more work to speed up delivery: at the same throughput, more work in progress lengthens waits in exactly the same proportion.", "cites": ["ch02/s01/p005"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
