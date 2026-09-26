---
name: make-flashcards
description: Turn one chapter, or a whole Bookshelf document, into one-fact spaced-repetition flashcards — from its remember callouts, definitions and key rules — each with a plain front and a short cited back, from the chapter distillations. Use for a flashcards artifact (pipeline stage 10, derive) or when the user asks for flashcards on a chapter anchor such as `ch02`, or on the whole book (no anchor).
argument-hint: <document-slug> [chapter-anchor]
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> [chapter-anchor]`, for example `okafor-queueing ch02`; with no anchor the skill works on the whole book.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-flashcards/inputs?document=<slug>&anchor=<anchor>"`
   (whole book: leave out `&anchor=<anchor>`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; let the user drop cards they already know cold.
3. Write `{"skill": "make-flashcards", "document": "<slug>", "anchor": <inputs.scope.anchor, null for the whole book>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-flashcards-<slug>-<anchor with / replaced by ->.json` (`make-flashcards-<slug>.json` for the whole book).
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding).
<!-- interactive:end -->

# Make flashcards

## Role

You turn what a chapter marks as worth remembering into cards for spaced repetition. Good
cards are small: **one fact, one answer**, a front that can only be answered one way. You read
the chapter's distillation (`chapter_distillations: [one item]`, `body.blocks` already cited
to source blocks) and nothing else.

**Book-wide** (`scope.anchor` is null): `chapter_distillations` holds every chapter in
reading order, and two more keys say what the book itself considers central: `book_brief`
(the brief's `thesis` and `ideas` sections) and `book_themes` (the book guide's recurring
themes, each citing every chapter it appears in). Either may be empty.

## Method

1. **Collect sources, in priority order:**
   1. every `remember` callout — each yields at least one card;
   2. every `definition` block — term on the front ("What is slack, in this book's sense?"), meaning on the back;
   3. key rules, numbers and formulas in `important` callouts, `math` blocks and `steps`;
   4. only if the chapter has none of the above: its core claims, at most five cards.
2. **Split** anything with several parts into several cards (minimum information principle):
   "Little's law relates which three quantities?" and "What does Little's law require of the
   system?" rather than one card holding both.
3. **Write the front** as a plain-text question or cue with exactly one right answer. No
   yes/no fronts, no "true or false", no front that contains its own answer.
4. **Write the back** as the shortest complete answer — usually under 25 words — as spans,
   citing the anchors of the distillation spans it comes from. Formulas: the LaTeX or the
   symbolic form exactly as the distillation gives it.
5. **5–20 cards per chapter**, no two testing the same fact.

### Book-wide deck

One deck that holds what the whole book wants remembered, reviewable in a few sessions, and
organised so a reader can study it topic by topic. Instead of step 5:

1. **Map the book before writing** (the map is not output): for each chapter, what it marks
   as worth remembering — `remember` callouts, definitions, rules, numbers, the parts and
   steps of its frameworks. Group the chapters into **4–7 topics that follow the book's own
   structure**.
2. **40–70 cards, grouped by topic.** `group` is the topic's name (2–5 words, the same string
   on every card of that topic); topics in book order, their cards contiguous. Per topic, in
   this order:
   - its core: a card for each `book_brief` idea and `book_themes` entry that belongs to it
     (what it is, as one fact);
   - its frameworks, **split into their parts**: one card per step, component or criterion
     ("What is the second step of …?", "Which criterion …?"), plus one card for what the
     framework is for;
   - its `remember` callouts, defined terms, key rules and numbers.
3. **One card per fact across the book.** A term or rule stated in several chapters gets one
   card, its back citing each chapter that states it (most specific anchors, up to four); a
   term the author refines later is carded in its final sense.
4. **Cover the book:** every chapter with something worth remembering has at least one card.
   The output is checked for this (`coverage_min`): an uncited chapter sends the deck back to
   review. Over 70, cut the least central cards of the busiest topics first.

## Hard rules

1. **Only the given input.** Every back is supported by the distillations (book-wide, the
   brief and themes may choose what to card, but the back still rests on the distillations);
   never add facts, mnemonics presented as the book's, or outside knowledge presented as the
   book's claim.
2. **Every back span cites ≥ 1 anchor** copied verbatim from the input — the block anchors
   inside the distillation spans you used, most specific first. Never construct, guess or
   shorten an anchor.
3. **Verbatim material stays verbatim**: numbers, formulas, defined terms copied exactly.
4. **Thin input:** fewer cards; if nothing is worth remembering, `{"items": []}`. Never pad.

## Output

One JSON object: `{"items": [{"front": "…", "back": [spans]}]}`; book-wide cards add
`"group": "<topic>"`, which a chapter deck leaves out.

## Example

Input (excerpt): the `ch02` distillation has a definition of "Little's law" (cites `ch02/s01/p001`), a `math` block `L = \lambda W` (cites `ch02/s01/m001`) and a caution "only while items leave as fast as they arrive" (cites `ch02/s01/p003`).

```json
{
  "items": [
    {"front": "Little's law: average items in a system equal what?", "back": [
      {"text": "Their arrival rate times the average time each spends inside (L = λW).", "cites": ["ch02/s01/p001", "ch02/s01/m001"]}]},
    {"front": "What must be true of a system for Little's law to hold?", "back": [
      {"text": "It must be stable: on average, items leave as fast as they arrive.", "cites": ["ch02/s01/p003"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
