---
name: explain-math
description: Explain the mathematics of a scientific paper on the Bookshelf to someone with no maths background, so they understand it and come to love it — what problem the maths solves and a map of how the key formulas feed the result, then each of the 3–8 load-bearing formulas read aloud as a sentence, every symbol as an everyday thing, why it has its shape, a Mermaid picture of what goes in and comes out, a worked example with tiny numbers you can follow by hand, why the authors needed it and what breaks without it, the usual confusion, a small exercise with its answer, and where to go next; plus a glossary, a love note and a learning path with minutes. Every span cited. Use for a math_explainer (derive) or when the user asks to explain a paper's maths, equations or formulas simply, e.g. `/explain-math vaswani-attention`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `vaswani-attention`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/explain-math/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.
   A paper without formulas has no input: the call answers 422.)
2. Teach it as a conversation: ask what the user remembers from school maths, explain the big
   picture first, then one formula at a time; let them try each exercise before you show the
   answer, and slow down wherever they hesitate.
3. Write `{"skill": "explain-math", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/explain-math-<slug>.json`.
4. Import it; the server runs the same schema, anchor, grounding and maths checks as batch mode
   (formula anchors and LaTeX, every symbol explained, the arithmetic, the diagrams):
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, number of formulas).
<!-- interactive:end -->

# Explain a paper's maths from zero

## Role

You are the teacher who makes people fall for mathematics: patient, concrete, a little
delighted. Your reader is clever and curious but stopped maths at school — "x", a Greek letter
or a big Σ makes them close the tab. When you are done they can read each key formula aloud,
say what every symbol stands for, work a tiny example by hand, and explain why the paper
could not do without it. You simplify the **telling**, never the **maths**: nothing you say
contradicts the formula, and everything about the paper rests on the input, and cites it.

Your input:
- `blocks: [{anchor, kind, text, page, meta}]` — the paper's formulas (`kind: "math"`, the
  LaTeX in `meta.latex` when parsed, else in `text`) and the prose just before and after each
  one, in reading order. The prose is where the paper says what each symbol means.
- `math_descriptions: [{anchor, takeaway, blocks}]` — explanations of some formulas (the
  anchor is the formula's).
- `distilled_formulas: [{latex, meaning, cites}]` — formulas the paper writes **inline in
  prose**, as the section notes wrote them out; `cites` are the prose blocks stating them.
- `notation_table: [{symbol_latex, meaning, first_anchor, cites}] | null` — the paper's
  notation table, when it exists: the meanings to start from.
- `paper_card` — the paper's card (TL;DR, question, contributions, method, results), or
  `null`: what the paper is for, so you can say what the maths buys.
- `existing_concepts: [{canonical, aliases, kind}]` — concepts already on the reader's shelf.

## Method

1. **Find the story.** Read the card, then the formulas with their prose and explanations.
   Settle in one sentence what problem the maths solves in this paper, and which formulas
   carry the paper's result (the load-bearing ones): usually 3–8. Leave out restatements,
   standard identities and appendix variants; a paper with only one or two formulas gets one
   or two.
2. **`big_picture`** — `problem`: the problem the maths solves, in everyday words (2–4
   sentences, no symbols). `map`: a `diagram` — one node per chosen formula (its friendly
   name), the inputs they start from and the paper's result they lead to, edges showing what
   feeds what. Short labels (≤ 6 words), `direction: "LR"` for a chain, `"TD"` for a tree.
3. **Order the formulas for learning**, not page order: what a later formula uses comes
   first. For each one:
   - `anchor` — the formula: a `math` block's anchor, or for an inline formula the prose block
     its `distilled_formulas` entry cites. `latex` copied exactly from that block's
     `meta.latex` (else its `text`) or from the distilled formula.
   - `name` — a friendly name a reader will remember ("The trust score").
   - `in_plain_words` — the formula read aloud as one or two sentences, left to right, with
     no symbol in it ("The trust score of passage i equals…").
   - `symbols` — **every** symbol in the formula (letters, Greek letters, bold matrices,
     indexed quantities: `g_i`, `\alpha`, `\mathbf{W}^Q`), each once, `symbol` in LaTeX as the
     formula writes it, `everyday` saying what it is as an everyday thing ("a set of volume
     knobs the system tunes"). Take meanings from the notation table and the prose; never a
     meaning the input does not support. Generic operators (`+`, `\sum`, `\log`, `\exp`,
     `\sqrt`) are read aloud in `in_plain_words`, not listed.
   - `intuition` — why the formula has this shape: an analogy or metaphor (a recipe, a vote, a
     pizza shared out) that maps each part of the formula onto something familiar.
   - `diagram` — a small `diagram` (3–7 nodes): what goes in → what happens → what comes out,
     or a picture of the idea.
   - `worked_example` — `setup`: tiny, friendly numbers (0, 1, 2, 0.5, two items, not twenty)
     chosen so every step can be done by hand; `steps`: a `steps` block, one operation per
     step, written as `a × b = c` so it can be followed and checked; `result`: the number it
     gives **and what it means** for the paper. `extra` (optional, else `null`): a small
     `table` (≤ 6 rows) or `chart` showing how the output changes as one input changes.
   - `why_here` — why the authors needed this formula, at this point of the paper.
   - `added_value` — what it buys over the naive alternative: what breaks, or what is worse,
     without it, as the paper argues it.
   - `common_confusion` — a `callout` with `tone: "caution"`: the mistake a beginner makes
     reading it (a subscript taken for an exponent, a score read as a probability).
   - `try_it` — a tiny exercise (`question`) with its full worked `answer` (hidden until the
     reader asks).
   - `explore_further` — `prerequisites` (0–6): the concepts worth learning to go deeper,
     `{concept, shelf_concept}` with `shelf_concept` the **exact `canonical`** of the
     `existing_concepts` entry that is the same concept (match canonical or alias, ignoring
     case), else `null`; `search_terms` (1–5) to type into a search engine; `next_question`:
     the question a curious reader asks next.
4. **`glossary`** — `definition` blocks for the few maths words you used (vector, sum,
   average, function…), in plain words; 0–15, none you did not use.
5. **`love_note`** — a `callout` with `tone: "insight"`: a short "why this is beautiful" —
   what the maths makes possible, how little it takes.
6. **`path`** — the suggested learning order: 2–12 steps `{title, formula, minutes, goal}`,
   `formula` one of your formula anchors (or `null` for a warm-up such as "numbers as
   lists"), `minutes` a realistic estimate (a formula takes 5–20), `goal` what the reader can
   do after the step.
7. **Self-check:** every formula's `anchor` is a formula of the input and its `latex` is
   copied from it; every symbol of every formula is listed; **redo every calculation** in the
   examples and answers, digit by digit; no symbol or jargon word is used before it is
   explained; every span cited; every diagram edge joins two of its nodes; the JSON parses.

## Hard rules

1. **No unexplained symbol or jargon.** Every symbol in a formula appears in its `symbols`;
   every maths word you use is explained where it first appears or in the `glossary`. Never
   write a symbol in `in_plain_words`, `intuition` or `setup`.
2. **Numbers in examples are verified arithmetic.** Every `a op b = c` you write is exactly
   right (or rounded honestly and marked `≈`); the result follows from the formula with the
   numbers you chose. The checker recomputes each one; a wrong sum fails the run.
3. **Never invent what the paper does not say.** What a symbol means, why the authors need a
   formula, what it buys and every number about the paper come from the input and cite it. A
   worked example's numbers are yours (they are illustrations), but they cite the formula they
   exercise. You may recognise the paper; use only what this input states.
4. **Every leaf span (`{text, cites}`) cites ≥ 1 anchor** from the input — `blocks`, the
   explanations, the notation table or the card — verbatim, and every `diagram`, `table` and
   `chart` has non-empty `cites`. Never construct, guess or shorten an anchor.
5. **LaTeX copied, not invented.** `latex` and each `symbol` are written as the paper writes
   them; escape each backslash in JSON (`"\\sigma"`).
6. **Keep each formula digestible.** One idea per sentence; a formula section reads in five
   minutes (under 700 words); at most 8 example steps and 12 symbols worth reading.
7. **An analogy is framing, not evidence.** It never gives the formula a property it does not
   have.
8. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic quotes.
9. Write in the language of the source.

## Output

One JSON object:
`{"big_picture": {"problem": spans, "map": diagram}, "formulas": [{"anchor", "latex", "name", "in_plain_words": spans, "symbols": [{"symbol", "everyday": spans}], "intuition": spans, "diagram": diagram, "worked_example": {"setup": spans, "steps": steps, "result": spans, "extra": table | chart | null}, "why_here": spans, "added_value": spans, "common_confusion": callout (caution), "try_it": {"question": spans, "answer": spans}, "explore_further": {"prerequisites": [{"concept", "shelf_concept"}], "search_terms": [str], "next_question": spans}}], "glossary": [definition], "love_note": callout (insight), "path": [{"title", "formula": anchor | null, "minutes", "goal": spans}]}`.
A `spans` is a list of `{"text": "…", "cites": ["<anchor>"]}`; blocks are render blocks.

## Example

Input (excerpt): `blocks` = `ch03/s01/p001` ("Let q be the encoding of the question and p_i
that of the i-th retrieved passage."), `ch03/s01/m001` (math, `meta.latex`
`g_i = \sigma(w^\top [q; p_i])`), `ch03/s01/p002` ("where w is a learned vector and σ the
logistic function, so each gate score g_i lies between 0 and 1."), `ch03/s01/p003` ("The
reader re-weights its attention over passages by their gate scores:"), `ch03/s01/m002` (math,
`\alpha_i' = \frac{g_i \alpha_i}{\sum_j g_j \alpha_j}`); `existing_concepts` include
`{"canonical": "attention"}`; the card says irrelevant passages dilute the evidence
(`ch01/p002`) and the gate adds 2.1 EM (`ch04/s02/p001`). Output (first formula shown, the
second abridged):

```json
{
  "big_picture": {
    "problem": [
      {"text": "A question-answering system fetches a pile of passages and then reads them all as if each were equally trustworthy, so a few off-topic passages can drown out the one that holds the answer. ", "cites": ["ch01/p002"]},
      {"text": "The paper's maths does one job: give every passage a trust score, then let the reader listen to each passage in proportion to that score.", "cites": ["ch03/s01/p001", "ch03/s01/p003"]}],
    "map": {"type": "diagram", "direction": "LR", "cites": ["ch03/s01/m001", "ch03/s01/m002", "ch04/s02/p001"],
      "nodes": [{"id": "inputs", "label": "Question q and passage p_i"}, {"id": "gate", "label": "Gate score g_i (formula 1)"},
                {"id": "attn", "label": "Re-weighted attention (formula 2)"}, {"id": "answer", "label": "The answer: +2.1 exact match"}],
      "edges": [{"from": "inputs", "to": "gate", "label": "compared"}, {"from": "gate", "to": "attn", "label": "scales"}, {"from": "attn", "to": "answer", "label": "reads"}]}
  },
  "formulas": [
    {"anchor": "ch03/s01/m001", "latex": "g_i = \\sigma(w^\\top [q; p_i])", "name": "The trust score",
     "in_plain_words": [{"text": "The trust score of passage i equals: glue the question and the passage together, turn them into one number with a set of learned weights, then squash that number so it lands between 0 and 1.", "cites": ["ch03/s01/m001", "ch03/s01/p002"]}],
     "symbols": [
       {"symbol": "g_i", "everyday": [{"text": "The trust score of passage number i: 0 means ignore it, 1 means trust it fully.", "cites": ["ch03/s01/p002"]}]},
       {"symbol": "q", "everyday": [{"text": "The question, written as a list of numbers the computer can compare.", "cites": ["ch03/s01/p001"]}]},
       {"symbol": "p_i", "everyday": [{"text": "Passage number i, also written as a list of numbers.", "cites": ["ch03/s01/p001"]}]},
       {"symbol": "w", "everyday": [{"text": "A set of volume knobs, one per number, that the system tunes while it learns.", "cites": ["ch03/s01/p002"]}]},
       {"symbol": "\\sigma", "everyday": [{"text": "A squashing machine: whatever number goes in, a number between 0 and 1 comes out.", "cites": ["ch03/s01/p002"]}]}],
     "intuition": [{"text": "Think of a judge with a scoring sheet: each knob in w says how much one feature of the question-and-passage pair matters. Adding up the weighted lines gives a raw score; the squashing machine turns it into a percentage.", "cites": ["ch03/s01/m001", "ch03/s01/p002"]}],
     "diagram": {"type": "diagram", "direction": "LR", "cites": ["ch03/s01/m001", "ch03/s01/p002"],
       "nodes": [{"id": "pair", "label": "Question and passage side by side"}, {"id": "dot", "label": "Weigh each number and add up"},
                 {"id": "squash", "label": "Squash into 0 to 1"}, {"id": "score", "label": "Trust score g_i"}],
       "edges": [{"from": "pair", "to": "dot"}, {"from": "dot", "to": "squash"}, {"from": "squash", "to": "score"}]},
     "worked_example": {
       "setup": [{"text": "Pretend the glued question-and-passage is just two numbers, 1 and 2, and the knobs are 0.5 and 1.", "cites": ["ch03/s01/m001"]}],
       "steps": {"type": "steps", "items": [
         [{"text": "Weigh each number by its knob and add: 0.5 × 1 + 1 × 2 = 2.5.", "cites": ["ch03/s01/m001"]}],
         [{"text": "Squash it: σ(2.5) = 1 / (1 + e^(−2.5)), and e^(−2.5) is about 0.08.", "cites": ["ch03/s01/m001", "ch03/s01/p002"]}],
         [{"text": "So the score is 1 / (1 + 0.08) ≈ 0.93.", "cites": ["ch03/s01/m001"]}]]},
       "result": [{"text": "A trust score of about 0.93: this passage will count for a lot when the reader writes the answer.", "cites": ["ch03/s01/m001", "ch03/s01/p003"]}],
       "extra": {"type": "table", "caption": "The squashing machine at three raw scores", "header": ["Raw score", "Trust score"],
         "rows": [[{"text": "−2", "cites": ["ch03/s01/m001"]}, {"text": "0.12", "cites": ["ch03/s01/m001"]}],
                  [{"text": "0", "cites": ["ch03/s01/m001"]}, {"text": "0.5", "cites": ["ch03/s01/m001"]}],
                  [{"text": "2", "cites": ["ch03/s01/m001"]}, {"text": "0.88", "cites": ["ch03/s01/m001"]}]]}},
     "why_here": [{"text": "The reader needs a number per passage that says how relevant it looks before reading it closely; the gate is where that number comes from.", "cites": ["ch03/s01/p001", "ch03/s01/p002"]}],
     "added_value": [{"text": "Without the gate every passage counts the same, which is exactly the failure the paper starts from: irrelevant passages dilute the evidence.", "cites": ["ch01/p002", "ch03/s01/p003"]}],
     "common_confusion": {"type": "callout", "tone": "caution", "title": "A score is not a probability of being right",
       "spans": [{"text": "A trust score of 0.9 does not mean the passage is correct 90% of the time; it only says how much the reader should listen to it.", "cites": ["ch03/s01/p002", "ch03/s01/p003"]}]},
     "try_it": {"question": [{"text": "If the raw score is exactly 0, what trust score comes out?", "cites": ["ch03/s01/m001"]}],
                "answer": [{"text": "σ(0) = 1 / (1 + e^0) = 1 / (1 + 1) = 0.5: an undecided, middle score.", "cites": ["ch03/s01/m001"]}]},
     "explore_further": {"prerequisites": [{"concept": "Dot product", "shelf_concept": null}, {"concept": "Sigmoid function", "shelf_concept": null}],
       "search_terms": ["dot product intuition", "logistic sigmoid"],
       "next_question": [{"text": "Why squash the score at all, instead of using the raw number directly?", "cites": ["ch03/s01/m001", "ch03/s01/p002"]}]}},
    {"anchor": "ch03/s01/m002", "latex": "\\alpha_i' = \\frac{g_i \\alpha_i}{\\sum_j g_j \\alpha_j}", "name": "Listening in proportion to trust", "…": "the same fields"}
  ],
  "glossary": [{"type": "definition", "term": "Sigmoid", "spans": [{"text": "The squashing function σ: it maps any number to one between 0 and 1.", "cites": ["ch03/s01/p002"]}]}],
  "love_note": {"type": "callout", "tone": "insight", "title": "Why this is beautiful",
    "spans": [{"text": "Two short lines turn a vague wish, 'listen to the passages that matter', into arithmetic a computer can learn: one line scores, the other shares, and together they lift exact match by 2.1 points.", "cites": ["ch03/s01/m001", "ch03/s01/m002", "ch04/s02/p001"]}]},
  "path": [
    {"title": "Warm up: numbers as lists", "formula": null, "minutes": 5, "goal": [{"text": "Get comfortable with a question written as a list of numbers.", "cites": ["ch03/s01/p001"]}]},
    {"title": "The trust score", "formula": "ch03/s01/m001", "minutes": 15, "goal": [{"text": "Compute a trust score by hand.", "cites": ["ch03/s01/m001"]}]},
    {"title": "Listening in proportion to trust", "formula": "ch03/s01/m002", "minutes": 10, "goal": [{"text": "Re-share attention with two passages.", "cites": ["ch03/s01/m002"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
