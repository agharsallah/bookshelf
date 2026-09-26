---
name: make-quiz
description: Write multiple-choice questions that test understanding (not recall of wording) of one chapter, or of a whole Bookshelf document across its chapters — apply a mechanism, predict an effect, tell two concepts apart, spot the antipattern — with plausible distractors and a cited explanation, from the chapter distillations. Use for a quiz artifact (pipeline stage 10, derive) or when the user wants to test themselves on a chapter anchor such as `ch03`, or on the whole book (no anchor).
argument-hint: <document-slug> [chapter-anchor]
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> [chapter-anchor]`, for example `okafor-queueing ch03`; with no anchor the skill works on the whole book.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-quiz/inputs?document=<slug>&anchor=<anchor>"`
   (whole book: leave out `&anchor=<anchor>`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below. Offer to quiz the user one question at a time before saving.
3. Write `{"skill": "make-quiz", "document": "<slug>", "anchor": <inputs.scope.anchor, null for the whole book>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-quiz-<slug>-<anchor with / replaced by ->.json` (`make-quiz-<slug>.json` for the whole book).
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

**Book-wide** (`scope.anchor` is null): `chapter_distillations` holds every chapter in
reading order, and two more keys say what the book itself considers central: `book_brief`
(the brief's `thesis` and `ideas` sections) and `book_themes` (the book guide's recurring
themes, each citing every chapter it appears in). Either may be empty.

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

### Book-wide quiz

A book quiz tells a reader whether they understood *the book* — its argument, its
frameworks and how to use them — not whether they read every chapter or remember its
wording. It should leave no major idea untested. Instead of step 2:

1. **Map the book before writing** (the map is not output): for each chapter, its central
   idea, the framework or method it teaches, its key numbers, and the mistakes it warns
   against. Mark chapters that add nothing new.
2. **Write 20–30 questions** that together cover the map:
   - **the argument** (from `book_brief`): at least two questions on the central claim and
     why it holds — asked as *apply* or *distinguish*, never "What is the book's thesis?";
   - **every framework or method** the book teaches: at least one question that makes the
     reader *use* it on a short scenario (which step comes next, which option the criteria
     pick, what the model predicts);
   - **connections**: at least a third are *connect* questions that need two or more
     chapters — how a later method depends on an earlier idea, which chapter's warning a
     scenario violates, how a `book_themes` entry develops. Their explanations cite an
     anchor in each chapter they draw on;
   - **the traps**: the `antipattern` and `caution` callouts the book stresses most, as
     *diagnose* questions whose distractors are the very mistakes it rebuts.
3. **Spread the difficulty:** about a quarter straightforward (one idea, stated plainly), half
   that need applying an idea to a new case, a quarter that need combining ideas.
4. **Cover the book:** every chapter with testable content is cited by at least one
   explanation; no chapter supplies more than a fifth of the questions. The output is checked
   for this (`coverage_min`): an uncited chapter sends the quiz back to review.
5. **Explain at depth:** 2–3 spans — why the answer is right (the mechanism or rule, with its
   number if it has one), and why the most tempting distractor is wrong.
6. **Order** questions by the chapter they rest on (a *connect* question sits at the latest
   chapter it needs), so the quiz follows the book.
7. `book_brief` and `book_themes` guide what to ask; answers and explanations still cite the
   anchors that state them — the block anchors inside the distillations, which the brief's
   and themes' own cites reuse.

## Hard rules

1. **Only the given input.** Questions, correct answers and explanations come solely from the
   distillations (and, book-wide, the brief and themes, which summarise them); a scenario may be invented to *apply* a stated mechanism, but its outcome must
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
