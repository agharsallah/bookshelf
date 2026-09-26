---
name: make-faq
description: Write the questions a thoughtful colleague would ask about one chapter, or a whole Bookshelf document (why, how, when not, what's the difference, what do I do) and answer each from the chapter distillations with citations. Use for an faq artifact (pipeline stage 10, derive) or when the user asks for an FAQ on a chapter anchor such as `ch04`, or on the whole book (no anchor).
argument-hint: <document-slug> [chapter-anchor]
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> [chapter-anchor]`, for example `okafor-queueing ch04`; with no anchor the skill works on the whole book.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-faq/inputs?document=<slug>&anchor=<anchor>"`
   (whole book: leave out `&anchor=<anchor>`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; ask the user which questions they would actually ask and adjust.
3. Write `{"skill": "make-faq", "document": "<slug>", "anchor": <inputs.scope.anchor, null for the whole book>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-faq-<slug>-<anchor with / replaced by ->.json` (`make-faq-<slug>.json` for the whole book).
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding).
<!-- interactive:end -->

# Make an FAQ

## Role

You anticipate how a smart colleague who has not read the chapter would question someone who
has — and you answer only with what the chapter says. The FAQ doubles as a search seed, so
questions are phrased the way people actually ask. You read the approved distillation(s) in
`chapter_distillations: [{anchor, heading, body}]` (one chapter, or every chapter for a
book-wide FAQ). You never see the source blocks; you cite through the distillation.

**Book-wide** (`scope.anchor` is null): `chapter_distillations` holds every chapter in
reading order, and two more keys say what the book itself considers central: `book_brief`
(the brief's `thesis` and `ideas` sections) and `book_themes` (the book guide's recurring
themes, each citing every chapter it appears in). Either may be empty.

## Method

1. **Read the distillation.** List its claims, mechanisms, definitions, `caution` and
   `antipattern` callouts, and any `contrast`.
2. **Write questions of these kinds**, in roughly this order of value:
   - *why* — "Why does starting more work slow delivery down?";
   - *how* — "How do I forecast delivery with Little's law?";
   - *when not* — limits and preconditions, from `caution` callouts;
   - *what's the difference* — from `contrast` callouts and paired definitions;
   - *what should I do / stop doing* — from `antipattern` callouts and prescriptions.
   Avoid trivia ("What does the author call…?"), yes/no questions, and questions whose answer
   is a single number without its meaning.
3. **Phrase each question** as a standalone question a person would type — no "in this
   chapter", no "according to the author" — ending with "?".
4. **Answer in 1–4 sentences** as spans, directly first ("Because…", "Divide…"), then the reason
   or condition. Use only the distillation's content.
5. **Cite** each answer span with the anchors of the distillation spans it draws on.
6. **5–10 items per chapter**, no two answering the same thing.

### Book-wide FAQ

A reader who reads only this FAQ should come away with a well-rounded grasp of the whole
book: its argument, every framework and method it teaches at working depth, how to apply
them, and where they stop. Not a stack of chapter FAQs, and not a list of one-liners.
Instead of steps 4 and 6:

1. **Map the book before writing** (the map is not output). For each chapter: its central
   idea, the framework, procedure or advice it contributes, and its key numbers and warnings.
   Mark chapters that add nothing new (thin front or back matter). Then group the chapters
   into **4–7 topics that follow the book's own structure** — its parts or movements, e.g.
   "The approach", "Choosing stories", "Telling them", "In the room", "Special situations".
2. **Write 20–30 items, grouped by topic.** `group` is the topic's name (2–5 words, the same
   string on every item of that topic); topics appear in book order and their items are
   contiguous. Within the FAQ as a whole, cover:
   - **the book as a whole** (first topic, from `book_brief`): its central claim and why it
     holds, what it asks a reader to do differently, where its advice stops applying;
   - **every framework, model or method the book teaches** — one *how* question each,
     answered with its actual parts, steps or criteria, not just its name;
   - **the connections** (`book_themes`, ideas several chapters develop): "How does X relate
     to Y?", "Does Z still hold when …?", citing an anchor in each chapter that states it;
   - **the situations the book addresses**: "What should I do when …?", from its
     prescriptions, `antipattern` and `caution` callouts.
   Each topic opens with its biggest question, then the specifics.
3. **Answer at working depth.** `answer`: 2–5 spans, about 50–120 words — the direct answer
   first, then the reason or mechanism, then the condition, caveat or number that makes it
   usable. Add `detail` (at most 3 blocks) when the answer has structure a reader will act
   on: `steps` for a procedure, `bullets` for criteria, parts or options, a `table` for a
   comparison ("X vs Y"), one `callout` (`antipattern`, `caution` or `remember`) for the trap
   the author warns about. Roughly a third to a half of the items carry detail; never repeat
   the answer's sentences in it.
4. **Cover the book.** Every chapter with substantive content is cited by at least one
   answer or detail; a chapter that matters only together with others is cited inside the
   answer that connects them. The output is checked for this (`coverage_min`): a chapter left
   uncited sends the FAQ back to review.
5. **Self-check before output:** every chapter on your map is cited somewhere; topics are in
   book order with contiguous items; no two items answer the same thing; every question
   stands alone; about 2,500–4,500 words in all.

## Hard rules

1. **Only the given input.** Answers come solely from the distillation(s) (and, book-wide,
   the brief and themes, which summarise them). If the distillation
   does not answer a natural question, do not ask it. Never present outside knowledge as the
   book's claim.
2. **Every answer span cites ≥ 1 anchor** copied verbatim from the input — the block anchors
   inside the distillation spans you used (most specific first), or a chapter anchor only for a
   chapter-wide claim. Never construct, guess or shorten an anchor.
3. **Verbatim material stays verbatim**: numbers, formulas and quoted phrases are copied
   exactly from the distillation.
4. **Detail blocks** follow the render contract, and every span inside them is cited like
   the answer's. `group` and `detail` are for book-wide FAQs; a chapter FAQ leaves them out.
5. **Thin input** (a distillation with little content): fewer items; if none can be answered,
   `{"items": []}`. Never pad.

## Output

One JSON object: `{"items": [{"question": "…?", "answer": [spans]}]}`; book-wide items add
`"group": "<topic>"` and, where useful, `"detail": [bullets | steps | table | callout blocks]`:
`{"type": "steps", "items": [[{"text": "…", "cites": ["<anchor>"]}], …]}` ·
`{"type": "table", "header": ["…", "…"], "rows": [[{"text": "…", "cites": ["<anchor>"]}, …]]}` ·
`{"type": "callout", "tone": "antipattern", "spans": [{"text": "…", "cites": ["<anchor>"]}]}`.

## Example

Input (excerpt): `chapter_distillations[0]` = `{"anchor": "ch04", "heading": "Limiting Work in Progress", "body": {"blocks": [… "Limits cut average cycle time from 31 to about 10 days while throughput stayed flat" cites ["ch04/s02/t001", "ch04/s02/p005"] …, caution "Work turned away at a limit still waits upstream, unmeasured" cites ["ch04/s03/p003"] …]}}`.

```json
{
  "items": [
    {"question": "Does limiting work in progress slow a team down?", "answer": [
      {"text": "Not in the author's data: with limits, average cycle time fell from 31 to about 10 days while throughput stayed flat.", "cites": ["ch04/s02/t001", "ch04/s02/p005"]}]},
    {"question": "Where does the work go when a WIP limit says no?", "answer": [
      {"text": "It waits upstream, where nobody measures it, so a limit hides a queue unless you track what it turns away.", "cites": ["ch04/s03/p003"]}]}
  ]
}
```

A book-wide item (excerpt of a 24-item FAQ; its topic's other items follow it):

```json
{"group": "Limiting work in progress", "question": "How do I set a WIP limit for my team?", "answer": [
  {"text": "Start from the work the team actually has in flight, set the limit a little below it, and lower it until work starts to wait for people rather than people for work.", "cites": ["ch04/s01/p002", "ch04/s01/p004"]},
  {"text": "The limit works because, at a steady throughput, less work in progress means proportionally shorter waits.", "cites": ["ch02/s01/p001"]}],
 "detail": [
  {"type": "steps", "items": [
    [{"text": "Count the items started but not finished.", "cites": ["ch04/s01/p002"]}],
    [{"text": "Set the limit just below that count and make it visible on the board.", "cites": ["ch04/s01/p003"]}],
    [{"text": "Track what the limit turns away, so the queue upstream stays visible.", "cites": ["ch04/s03/p003"]}]]},
  {"type": "callout", "tone": "antipattern", "spans": [{"text": "Raising the limit whenever it blocks someone, which quietly removes it.", "cites": ["ch04/s03/p005"]}]}]}
```

Output only the JSON object. No prose, no code fences.
