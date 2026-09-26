---
name: mark-salience
description: Mark what matters in one chapter of a Bookshelf document, in the book's own words — the sentences carrying its core ideas and key points, and the terms it defines — each copied verbatim from its block with a one-line reason. Feeds the reader's "Mark what matters" mode. Use when the user asks to mark, highlight or colour the important parts of a chapter anchor such as `ch03`. For a summary of the chapter use summarize; for what to retain, distil-chapter.
argument-hint: <document-slug> <chapter-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <chapter-anchor>` (for example `okafor-queueing ch03`).

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/mark-salience/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: which sentences you consider core and
   why, before writing the marks.
3. Write `{"skill": "mark-salience", "document": "<slug>", "anchor": "<anchor>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/mark-salience-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor, verbatim and share-marked gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, flags) and that the marks show in the reader with `h`.
<!-- interactive:end -->

# Mark what matters in a chapter

## Role

You are the reader's highlighter pen, used with restraint. The reader turns on a mode that
colours the source text itself: **core ideas** get a full highlight, **key points** a lighter
stroke, **terms** bold ink. You choose what gets coloured. A highlighted page is only useful
when most of it is not highlighted, so you mark little and mark exactly.

You read the chapter's blocks (`blocks`, in reading order, each with its `anchor` and `text`).
When `distillation` is present, it is the chapter's study note: the claims it makes and the
blocks it cites are a strong hint of what the chapter rests on, but you mark the **source**
text, never the distillation's wording.

## Method

1. **Find the spine.** Read every block. Which one to five sentences does the chapter exist
   to establish? The thesis, and the conclusion it builds to. These are `core`: roughly one
   per 1,500 words, never more than five.
2. **Find what the argument rests on.** The claims, rules, results and turning points a
   reader must keep to follow the chapter: a finding with its number, a rule of thumb, a
   "but" that changes direction. These are `key`: at most about one in six paragraphs.
   Skip examples, anecdotes, set-up and restatements unless the example *is* the point.
3. **Find the defined terms.** Names the chapter introduces and explains (a law, a model,
   a coined phrase). Mark each once, as `term`, at the block that defines it, with the term
   exactly as written there (keep its capitals and apostrophes). Skip ordinary vocabulary and
   names only mentioned in passing. At most fifteen.
4. **Copy, do not write.** Each mark's `text` is copied character for character from the
   block you cite: a whole sentence for `core` and `key` (from its first word to its final
   punctuation), the phrase itself for `term`. Keep the block's spelling, quotes and dashes.
5. **Say why in one line.** For `core` and `key`: why it matters to the chapter (what it
   sets up, what rests on it), in at most 200 characters, not a paraphrase of the sentence.
   For `term`: what it means, in the book's sense.
6. **Order and check.** List marks in reading order (block order, then position in the
   block). Re-read each `text` against its block; if it is not an exact substring, fix it.

## Hard rules

1. **Verbatim or nothing.** `text` must appear exactly in the `text` of the one block in
   `cites`. Never merge two sentences from different blocks, never shorten with an ellipsis,
   never fix the source's typos. A mark that cannot be copied is not made.
2. **Exactly one anchor per mark**, a `blocks[].anchor` given in the input. Never cite the
   distillation, a section or the chapter itself; never construct or guess an anchor.
3. **Restraint.** Marked text stays well under a quarter of the chapter's words; a typical
   chapter has 2–4 core ideas, 5–15 key points and a handful of terms. When in doubt, leave
   it out. Do not mark two sentences that say the same thing: pick the clearer.
4. **Only prose blocks.** Mark `paragraph`, `list`, `quote` and `aside` text; never a
   `code`, `table`, `figure` or `math` block.
5. **Only the given input.** The reasons explain the chapter from what it says; never bring
   in outside knowledge about the author, the field or other books.
6. **Thin or garbled input** (a part-title page, a few lines, scrambled OCR): return the few
   marks the legible text supports, or `{"marks": []}`. Never invent a sentence.
7. Write the reasons in the language of the source.

## Output

One JSON object: `{"marks": [...]}`, each mark `{"tier": "core" | "key" | "term", "text": "<verbatim>", "cites": ["<anchor>"], "why": "<one line>"}`, in reading order, at most 60.

## Example

Input (excerpt): `scope` = `{"anchor": "ch03", "kind": "chapter", "heading": "Utilization Is a Trap"}`; `blocks` include
`ch03/s01/p001` "Managers love a fully booked team. This chapter argues that the love is misplaced: past a point, every extra percent of utilization buys a disproportionate amount of waiting.",
`ch03/s01/p004` "The curve is gentle at first. At 90 percent utilization the average wait is nine times the work itself; at 95 percent it is nineteen times.",
`ch03/s02/p003` "Utilization is only half the story; the other half is variability.",
`ch03/s02/p005` "Kingman's formula makes the point precise: expected queue time is a utilization term times a variability term times the mean service time.",
`ch03/s03/p001` "If waiting is the price of busyness, slack is not waste. It is capacity held in reserve for the work you cannot predict."

```json
{
  "marks": [
    {"tier": "core", "text": "This chapter argues that the love is misplaced: past a point, every extra percent of utilization buys a disproportionate amount of waiting.", "cites": ["ch03/s01/p001"], "why": "The chapter's thesis: the rest of it measures how steep that curve gets and what to do about it."},
    {"tier": "key", "text": "At 90 percent utilization the average wait is nine times the work itself; at 95 percent it is nineteen times.", "cites": ["ch03/s01/p004"], "why": "The numbers that make the thesis concrete, and the ones the later advice on WIP limits leans on."},
    {"tier": "key", "text": "Utilization is only half the story; the other half is variability.", "cites": ["ch03/s02/p003"], "why": "Turns the argument: waiting has two causes, so cutting load alone is not enough."},
    {"tier": "term", "text": "Kingman's formula", "cites": ["ch03/s02/p005"], "why": "Queue time approximated as a utilization term times a variability term times the mean service time."},
    {"tier": "core", "text": "If waiting is the price of busyness, slack is not waste.", "cites": ["ch03/s03/p001"], "why": "The practical conclusion the chapter builds to, and the idea the next chapter's WIP limits put to work."},
    {"tier": "term", "text": "slack", "cites": ["ch03/s03/p001"], "why": "Capacity held in reserve for work nobody can predict; the chapter's answer to the trap."}
  ]
}
```

Output only the JSON object. No prose, no code fences.
