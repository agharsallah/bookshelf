---
name: describe-math
description: Transcribe one formula from a Bookshelf document into KaTeX-ready LaTeX and explain it — what it says, what each symbol stands for, and when it holds — as cited render blocks with an honest confidence. Use for a math block (pipeline stage 2) or when the user asks what a specific formula anchor such as `ch03/s02/m001` means.
argument-hint: <document-slug> <math-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <math-anchor>`, for example `okafor-queueing ch03/s02/m001`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/describe-math/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. If `element.image_path` is present it is relative to the repository's `.media/` directory:
   open `.media/<image_path>` with the Read tool. Confirm ambiguous glyphs with the user.
3. Do the work below, then write
   `{"skill": "describe-math", "document": "<slug>", "anchor": "<inputs.scope.anchor>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/describe-math-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, rejected anchors).
<!-- interactive:end -->

# Describe a formula

## Role

You make one formula readable and searchable by meaning. You transcribe it **exactly** to
LaTeX, then say what it states, what every symbol stands for and under which conditions the
book says it holds — all in the book's own terms. You read the formula block (`element`: its
`text`, `meta.latex` if the parser found one, and `image_path` for a cropped display formula)
and the two blocks on either side of it (`context`), which usually define the symbols.

## Method

1. **Get the formula.** If `element.image_path` is present, read the image (a relative path is
   relative to the repository's `.media/` directory). If `element.meta.latex` exists and matches
   the image (or there is no image), start from it. Otherwise transcribe from the image, and
   use `element.text` only as a hint — extracted glyph text is often scrambled.
2. **Write `latex`.** Math-mode LaTeX without `$`, `\[`, `\begin{equation}` or equation-number
   tags; KaTeX-compatible commands only (`\frac`, `\left(`, `\mathbb`, `\sum`, `\approx`…).
   Keep the author's symbols, order, grouping and notation. Do not simplify, rearrange,
   substitute values or "fix" the formula.
3. **First block: a `math` block** with the same `latex`, `cites: ["<element.anchor>"]`, and
   `meaning`: one to three spans stating in words what the formula says — the relationship,
   not a symbol-by-symbol reading. Use the book's framing from `context`.
4. **One `definition` block per symbol** that appears in the formula, in order of appearance:
   `term` is the symbol as a reader sees it (`ρ`, `c_a`, `E[W_q]`), `spans` its meaning and unit
   as `context` gives them, cited to the defining block.
   - A symbol the context does not define: if it is universal notation (`Σ`, `E[·]`, `≈`), give
     the conventional reading, cite `element.anchor`, and cap `confidence` at `medium`; if it is
     not universal, write "Not defined in the surrounding text." citing `element.anchor` and cap
     `confidence` at `medium`. Never guess a domain meaning.
5. **Conditions (optional `callout`, tone `caution`)** — the assumptions or limits the author
   states (approximation, regime, units). Only what the text says.
6. **Worked example (optional `paragraph`)** only if `context` contains one; copy its numbers exactly.
7. **`confidence`:**
   - `high`: transcription certain (clean image or trustworthy `meta.latex`) and every symbol defined in `context`.
   - `medium`: transcription certain but a symbol undefined, or one glyph ambiguous (prime vs. apostrophe, subscript vs. index).
   - `low`: image unreadable or absent with scrambled text, or the formula's structure is a guess.

## Hard rules

1. **Verbatim first.** `latex` and the `math` block's `latex` are identical and are a faithful
   transcription; never paraphrase a formula into different math.
2. **Only the given input.** Meanings, units and conditions come from `context`; outside
   knowledge is limited to universal notation (rule 4 of Method) and is never presented as the
   book's claim. No derivations the book does not make.
3. **Every span cites ≥ 1 anchor that appears verbatim in the input**: the defining `context`
   block for a meaning, `element.anchor` for what is read off the formula. Cite the most
   specific block. Never construct, guess or shorten an anchor.
4. **Unreadable input:** return a minimal valid object — your best `latex` for what is legible
   (or the raw `element.text` if nothing is), one `math` block whose `meaning` says only what the
   context says about it (cited), and `confidence: low`. Do not invent structure.
5. Inline formulas are treated the same way; keep the output proportionate (a one-symbol
   formula needs one definition, not five blocks).

## Output

One JSON object: `{"latex", "blocks", "confidence"}`. `blocks` starts with the `math` block,
followed by `definition` blocks and any `callout`, `paragraph` or `bullets` (at most 16 blocks).

## Example

Input (excerpt): `element` = `{"anchor": "ch03/s02/m001", "kind": "math", "meta": {"inline": false}, "image_path": "okafor-queueing/ch03-s02-m001.png"}`;
`context` includes `ch03/s02/p006` "Kingman's approximation separates the three things that make you wait: how busy the server is, how variable the work is, and how long each item takes.", `ch03/s02/p007` "Here ρ is utilization, c_a and c_s are the coefficients of variation of the time between arrivals and of the service time, and t_s is the mean service time.", `ch03/s02/p008` "It is an approximation for a single server under heavy load; at low utilization it overstates the wait."

```json
{
  "latex": "E[W_q] \\approx \\left(\\frac{\\rho}{1-\\rho}\\right)\\left(\\frac{c_a^2 + c_s^2}{2}\\right) t_s",
  "blocks": [
    {"type": "math", "latex": "E[W_q] \\approx \\left(\\frac{\\rho}{1-\\rho}\\right)\\left(\\frac{c_a^2 + c_s^2}{2}\\right) t_s", "cites": ["ch03/s02/m001"],
     "meaning": [{"text": "Expected time in the queue is roughly the product of a utilization term, a variability term and the mean service time.", "cites": ["ch03/s02/m001", "ch03/s02/p006"]}]},
    {"type": "definition", "term": "E[W_q]", "spans": [{"text": "Expected value (E[·]) of W_q. W_q is not defined in the surrounding text, which frames the formula as the time you wait.", "cites": ["ch03/s02/m001", "ch03/s02/p006"]}]},
    {"type": "definition", "term": "ρ", "spans": [{"text": "Utilization of the server.", "cites": ["ch03/s02/p007"]}]},
    {"type": "definition", "term": "c_a, c_s", "spans": [{"text": "Coefficients of variation of the time between arrivals and of the service time.", "cites": ["ch03/s02/p007"]}]},
    {"type": "definition", "term": "t_s", "spans": [{"text": "Mean service time.", "cites": ["ch03/s02/p007"]}]},
    {"type": "callout", "tone": "caution", "spans": [{"text": "An approximation for a single server under heavy load; it overstates the wait at low utilization.", "cites": ["ch03/s02/p008"]}]}
  ],
  "confidence": "medium"
}
```

Confidence is `medium` because `W_q` is not defined in the surrounding text.

Output only the JSON object. No prose, no code fences.
