---
name: make-quiz
description: Write multiple-choice questions that test understanding (not recall of wording) of one chapter of a Bookshelf document — apply a mechanism, predict an effect, tell two concepts apart, spot the antipattern — with plausible distractors and a cited explanation, from the chapter distillation. Use for a quiz artifact (pipeline stage 10, derive) or when the user wants to test themselves on a chapter anchor such as `ch03`.
argument-hint: <document-slug> <chapter-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <chapter-anchor>`, for example `okafor-queueing ch03`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-quiz/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below. Offer to quiz the user one question at a time before saving.
3. Write `{"skill": "make-quiz", "document": "<slug>", "anchor": "<inputs.scope.anchor>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-quiz-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding).
<!-- interactive:end -->

# Make a quiz

## Role

You write a short quiz that tells a reader whether they *understood* a chapter, not whether
they memorised its sentences. A wrong answer should teach something: its explanation links
back to the passage. You read the chapter's distillation (`chapter_distillations: [one item]`,
`body.blocks` already cited to source blocks) and nothing else.

## Method

1. **Pick what is worth testing:** `important` claims, mechanisms (`steps`), `chart` / `table`
   data with a clear pattern, `contrast` pairs, `antipattern` and `caution` callouts,
   definitions that are easy to confuse.
2. **Write 5–10 questions**, mixing these kinds:
   - *apply* — a short scenario; which outcome does the mechanism predict?
   - *predict* — "what happens to X when Y", from chart or table data;
   - *distinguish* — which statement describes concept A rather than B?
   - *diagnose* — which practice is the one the book warns against?
   Recall questions ("What is the name of…") only for a definition that matters, at most one.
3. **Choices: 3–5, exactly one correct.** Distractors are plausible misconceptions — ideally
   the very mistakes the book rebuts in its `antipattern` or `caution` callouts — of similar
   length and grammar to the answer. No "all of the above", "none of the above", jokes or
   trick wording. Vary the correct answer's position.
4. **`answer`** is the 0-based index of the correct choice in `choices`.
5. **`explanation`** (1–3 sentences as spans): why the right answer is right, and, when useful,
   why the most tempting distractor is wrong. Cite the distillation anchors it rests on.

## Hard rules

1. **Only the given input.** Questions, correct answers and explanations come solely from the
   distillation; a scenario may be invented to *apply* a stated mechanism, but its outcome must
   follow from what the book says. Never present outside knowledge as the book's claim.
2. **Every explanation span cites ≥ 1 anchor** copied verbatim from the input — the block
   anchors inside the distillation spans you used, most specific first. Never construct, guess
   or shorten an anchor.
3. **`answer` must index an existing choice** (0 ≤ answer < number of choices), and only that
   choice is defensible from the distillation.
4. **Numbers and formulas are copied exactly**; distractor numbers must be clearly wrong by the
   book's data, not merely rounded differently.
5. **Thin input:** fewer questions; if nothing is testable, `{"items": []}`. Never pad.

## Output

One JSON object: `{"items": [{"question", "choices": [3–5 strings], "answer": <int>, "explanation": [spans]}]}`.

## Example

Input (excerpt): the `ch03` distillation includes a chart of average wait against utilization (50→1, 80→4, 90→9, 95→19 times the service time; cites `ch03/s01/f001`), the claim "waiting scales with utilization and variability together" (cites `ch03/s02/p003`) and the antipattern "planning to 100% capacity" (cites `ch03/s03/p002`).

```json
{
  "items": [
    {"question": "A team's utilization rises from 80% to 90%. By the chapter's curve, what happens to the average wait?",
     "choices": ["It rises by about an eighth, in line with the extra load", "It more than doubles, from about 4 to about 9 times the service time", "It stays flat until utilization reaches 100%", "It falls, because busier teams finish work faster"],
     "answer": 1,
     "explanation": [{"text": "The curve turns steep past 80%: the wait goes from about 4 to about 9 times the service time; the growth is far faster than the 12.5% rise in load.", "cites": ["ch03/s01/f001", "ch03/s01/p004"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
