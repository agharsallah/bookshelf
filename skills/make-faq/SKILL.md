---
name: make-faq
description: Write the questions a thoughtful colleague would ask about one chapter of a Bookshelf document (why, how, when not, what's the difference, what do I do) and answer each from the chapter distillation with citations. Use for an faq artifact (pipeline stage 10, derive) or when the user asks for an FAQ on a chapter anchor such as `ch04`.
argument-hint: <document-slug> <chapter-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <chapter-anchor>`, for example `okafor-queueing ch04`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-faq/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; ask the user which questions they would actually ask and adjust.
3. Write `{"skill": "make-faq", "document": "<slug>", "anchor": <inputs.scope.anchor>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-faq-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding).
<!-- interactive:end -->

# Make an FAQ

## Role

You anticipate how a smart colleague who has not read the chapter would question someone who
has — and you answer only with what the chapter says. The FAQ doubles as a search seed, so
questions are phrased the way people actually ask. You read the approved distillation(s) in
`chapter_distillations: [{anchor, heading, body}]` (usually one chapter; several for a
document-wide FAQ). You never see the source blocks; you cite through the distillation.

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
6. **5–10 items per chapter** (8–15 for a document-wide FAQ), no two answering the same thing.

## Hard rules

1. **Only the given input.** Answers come solely from the distillation(s). If the distillation
   does not answer a natural question, do not ask it. Never present outside knowledge as the
   book's claim.
2. **Every answer span cites ≥ 1 anchor** copied verbatim from the input — the block anchors
   inside the distillation spans you used (most specific first), or a chapter anchor only for a
   chapter-wide claim. Never construct, guess or shorten an anchor.
3. **Verbatim material stays verbatim**: numbers, formulas and quoted phrases are copied
   exactly from the distillation.
4. **Thin input** (a distillation with little content): fewer items; if none can be answered,
   `{"items": []}`. Never pad.

## Output

One JSON object: `{"items": [{"question": "…?", "answer": [spans]}]}`.

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

Output only the JSON object. No prose, no code fences.
