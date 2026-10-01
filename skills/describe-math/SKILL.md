---
name: describe-math
description: Transcribe one formula from a Bookshelf document into KaTeX-ready LaTeX and explain it — what it says, what the text uses it for, what each symbol stands for, how its parts fit together and when it holds — as cited render blocks with an honest confidence. Use for a math block (pipeline stage 2) or when the user asks what a specific formula anchor such as `ch03/s02/m001` means.
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
LaTeX, then say what it states, what the text uses it for, what every symbol stands for, how
its parts fit together and under which conditions the text says it holds, all in the text's
own terms. Downstream skills (the notation table, the paper's math explainer) build on what
you write, so a wrong symbol or an invented meaning spreads.

## Inputs

- `element`: the formula block: its `anchor`, `text` (the PDF's glyphs, often scrambled: a
  `�` is a stretched delimiter the extractor could not map, and fractions and scripts come
  out in no reliable order), `meta.latex` (a glyph-by-glyph guess, or `null`), `meta.equation_no`
  (the printed number, if any) and `image_path` (a crop of the formula as printed).
- `context`: the nearest blocks on each side, in reading order. It holds the prose that
  introduces the formula ("… by maximizing the following objective:") and the "where …"
  paragraph that defines its symbols. Short glyph-only blocks in `context` (`𝑖=1`, `∑︁`,
  `� min`, `, (2)`) are usually pieces of a formula the parser split.

## Method

1. **Read the image first.** If `element.image_path` is present, read the image (a relative
   path is relative to the repository's `.media/` directory). It is the source of truth.
   Start from `meta.latex` only when it matches the image symbol for symbol; use
   `element.text` only to confirm a glyph the image leaves ambiguous.
2. **Decide whether the formula is whole.** It is whole when every bracket it opens closes,
   and it neither starts nor ends mid-expression (on an operator, a comma, or a function
   name with no argument such as a bare `clip` or `min`). If the image shows only part of a
   formula, or `context` holds its other pieces, follow **Fragments** below and skip steps 6–7.
3. **Write `latex`**, the formula as printed, in KaTeX-ready math mode:
   - No `$`, `\[`, `\begin{equation}`, `\tag` or `\label`. The equation number goes in
     the meaning, never in the LaTeX.
   - Balanced: every `{` closed, every `\left` paired with a `\right`, every `\begin{…}` with
     its `\end{…}`. Several printed lines go in `\begin{aligned} … \\ … \end{aligned}`, and
     piecewise definitions in `\begin{cases}`.
   - Notation: `\mid` for a conditional bar (`\pi_\theta(o_i \mid q)`), `\|` between the
     arguments of a divergence or a norm, `\mathbb{E}`, `\mathbb{D}_{KL}`, `\mathcal{J}`,
     `\hat{A}_t`; a word as a subscript in `\mathrm{}` (`\pi_{\theta_{\mathrm{old}}}`); a
     multi-letter function in `\operatorname{}` (`\operatorname{clip}`) unless KaTeX has
     it built in (`\min`, `\max`, `\log`, `\exp`).
   - Keep the author's symbols, order, grouping and notation. Do not simplify, rearrange,
     substitute values or "fix" the formula.
4. **First block: a `math` block** with the same `latex`, `cites: ["<element.anchor>"]`, and
   `meaning`: one to three spans.
   - What the formula says, as a relationship ("the advantage is the reward's distance from
     the group mean, in standard deviations"), not a symbol-by-symbol reading.
   - What the text uses it for (the objective the policy maximizes, the definition of a
     quantity, an estimate, an update rule, a bound), cited to the context block that says
     so. Name the formula only as the text names it, and say "Equation (n)" when
     `meta.equation_no` is set.
5. **One `definition` block per symbol** that a reader must know, in order of appearance.
   `term` is the symbol as a reader sees it (`ρ`, `c_a`, `E[W_q]`); `spans` give its meaning
   and unit. Group versions of one thing into one term (`π_θ, π_θold, π_ref`). Look for the
   meaning in this order:
   - **The text.** Search every `context` block, before and after the formula. Lead-in
     sentences define symbols too ("for each question q, GRPO samples outputs o_1 … o_G
     from the old policy π_θold" defines q, o_i, G and π_θold). Cite the block that says it.
   - **The formula itself.** Read off what its structure shows: an index bound by a sum
     (`i` in `Σ_{i=1}^{G}` runs over the G outputs), a quantity the formula defines (the
     left-hand side of `A_i = …`), the limits of a `clip`. Cite `element.anchor`, plus the
     context block for any meaning taken from the text.
   - **Universal notation.** Give the conventional reading and cite `element.anchor`:
     `E[·]` expectation, `Σ` `∏` sum and product, `log` `exp`, `min` `max` `argmax`, `∇` `∂`
     gradient and partial derivative, `‖·‖` norm, `D_KL(P‖Q)` Kullback–Leibler divergence,
     `clip(x, a, b)` x limited to [a, b], `∼` "drawn from", `mean` `std` `σ(·)`
     `softmax` `𝟙[·]` as named. Operators (`Σ`, `min`, `clip`, `log`) get no definition
     block: their reading goes in the "how it is built" bullets (step 6). `E[·]` gets one
     only to say what it averages over. A meaning read from notation does not lower
     `confidence`.
   - **Nothing found:** "Not defined in the surrounding text." Add only what the notation
     itself shows ("θ, as a subscript, marks the parameters of π"). Never guess a domain
     meaning.
6. **How it is built (optional `bullets`)**, for a formula of two or more parts: one item
   per top-level part (term, factor, constraint), in formula order. Say what the part
   computes and how it combines with the rest ("the min keeps the smaller of the plain and
   the clipped term"). Add what the form implies when that follows from the math alone
   ("grows without bound as ρ approaches 1", "is 0 when the two policies agree"). Cite
   `element.anchor`, plus the context block for any meaning taken from the text. No
   empirical claims, no motivation the text does not give, and no name the text does not
   use (say "PPO-style clipping" only if the text says it). Skip this block for a one-part
   formula.
7. **Conditions (optional `callout`, tone `caution`)** are the assumptions or limits the
   author states (an approximation, a regime, units). Only what the text says.
8. **Worked example (optional `paragraph`)** only if `context` contains one. Copy its numbers exactly.
9. **Set `confidence`:**
   - `high`: the formula is whole, the transcription is certain, and every symbol a reader
     needs is defined by the text, bound in the formula or universal notation.
   - `medium`: the transcription is certain, but a symbol that carries meaning is not
     defined anywhere, or one glyph is ambiguous (prime vs. apostrophe, subscript vs. index).
   - `low`: a fragment; an image that is missing or unreadable while the text is
     scrambled; or a guessed structure.

## Fragments

The parser sometimes cuts one printed formula into several blocks. Describing a fragment
as if it were whole misleads every skill that reads it. For a fragment:

- `latex` is only what the image shows, still balanced: a delimiter the excerpt leaves open
  is a plain `(` or `[`, never a `\left(` with no `\right`. Do not complete it from `context`.
- The `math` block's `meaning` starts with "Part of a larger formula", followed by
  "(equation (n))" when a neighbour carries the number. Cite `element.anchor` and that
  neighbour. Then add what the whole formula is for, cited to the prose that introduces it.
- Give definitions for the symbols you can see, found as in step 5. The prose around a
  split formula usually defines them.
- No "how it is built" block and no conditions. Set `confidence: low` so a person can
  re-parse the document or write the description by hand.

## Hard rules

1. **Verbatim first.** `latex` and the `math` block's `latex` are identical and are a faithful
   transcription. Never paraphrase a formula into different math.
2. **It typesets.** The server refuses LaTeX that is unbalanced, wrapped in display
   delimiters or carries `\tag`. In the JSON reply, write every LaTeX backslash twice
   (`"\\frac{a}{b}"`, `"\\text{clip}"`). A single backslash turns `\t`, `\f`, `\n` or `\b`
   into a control character and breaks the formula.
3. **Only the given input.** Meanings, units, names and conditions come from `context`.
   Outside knowledge is limited to universal notation (step 5) and to consequences of the
   formula's form (step 6), and is never presented as the text's claim. No derivations
   the text does not make.
4. **Every span cites ≥ 1 anchor that appears verbatim in the input**: the defining `context`
   block for a meaning, `element.anchor` for what is read off the formula. Cite the most
   specific block. Never construct, guess or shorten an anchor.
5. **Unreadable input:** return a minimal valid object. Give your best `latex` for what is
   legible, or the raw `element.text` if nothing is, and one `math` block whose `meaning`
   says only what the context says about it (cited), with `confidence: low`. Do not invent
   structure.
6. Treat inline formulas the same way, and keep the output proportionate: a one-symbol
   formula needs one definition, not five blocks.

## Output

One JSON object: `{"latex", "blocks", "confidence"}`. `blocks` starts with the `math` block,
followed by `definition` blocks, then an optional `bullets` (how it is built), `callout` and
`paragraph` (at most 16 blocks).

- `definition`: `{"type": "definition", "term": "ρ", "spans": [{"text": "…", "cites": ["<anchor>"]}]}`
- `bullets`: `{"type": "bullets", "items": [[{"text": "…", "cites": ["<anchor>"]}], …]}`, one list of spans per item.
- `callout`: `{"type": "callout", "tone": "caution", "spans": [{"text": "…", "cites": ["<anchor>"]}]}`

## Example

Input (excerpt): `element` = `{"anchor": "ch03/s02/m001", "kind": "math", "meta": {"inline": false, "latex": null, "equation_no": null}, "image_path": "okafor-queueing/ch03-s02-m001.png"}`.
`context` includes:
- `ch03/s02/p006`: "Kingman's approximation separates the three things that make you wait: how busy the server is, how variable the work is, and how long each item takes."
- `ch03/s02/p007`: "Here ρ is utilization, c_a and c_s are the coefficients of variation of the time between arrivals and of the service time, and t_s is the mean service time."
- `ch03/s02/p008`: "It is an approximation for a single server under heavy load; at low utilization it overstates the wait."

```json
{
  "latex": "E[W_q] \\approx \\left(\\frac{\\rho}{1-\\rho}\\right)\\left(\\frac{c_a^2 + c_s^2}{2}\\right) t_s",
  "blocks": [
    {"type": "math", "latex": "E[W_q] \\approx \\left(\\frac{\\rho}{1-\\rho}\\right)\\left(\\frac{c_a^2 + c_s^2}{2}\\right) t_s", "cites": ["ch03/s02/m001"],
     "meaning": [{"text": "Expected time in the queue is roughly the product of three factors: how busy the server is, how variable the work is, and how long each item takes.", "cites": ["ch03/s02/m001", "ch03/s02/p006"]},
                 {"text": "The text calls it Kingman's approximation and uses it to separate the three things that make you wait.", "cites": ["ch03/s02/p006"]}]},
    {"type": "definition", "term": "E[W_q]", "spans": [{"text": "Expected value (E[·]) of W_q. W_q is not defined in the surrounding text, which frames the formula as the time you wait.", "cites": ["ch03/s02/m001", "ch03/s02/p006"]}]},
    {"type": "definition", "term": "ρ", "spans": [{"text": "Utilization of the server.", "cites": ["ch03/s02/p007"]}]},
    {"type": "definition", "term": "c_a, c_s", "spans": [{"text": "Coefficients of variation of the time between arrivals and of the service time.", "cites": ["ch03/s02/p007"]}]},
    {"type": "definition", "term": "t_s", "spans": [{"text": "Mean service time.", "cites": ["ch03/s02/p007"]}]},
    {"type": "bullets", "items": [
      [{"text": "ρ/(1 − ρ), the utilization factor: it grows without bound as ρ approaches 1, so a nearly full server makes the wait explode.", "cites": ["ch03/s02/m001", "ch03/s02/p007"]}],
      [{"text": "(c_a² + c_s²)/2, the variability factor: the average of the two squared coefficients of variation; it is 0 when neither arrivals nor service vary.", "cites": ["ch03/s02/m001", "ch03/s02/p007"]}],
      [{"text": "t_s scales the product to the mean service time, so the wait is measured in the same unit as the work.", "cites": ["ch03/s02/m001", "ch03/s02/p007"]}]]},
    {"type": "callout", "tone": "caution", "spans": [{"text": "An approximation for a single server under heavy load; at low utilization it overstates the wait.", "cites": ["ch03/s02/p008"]}]}
  ],
  "confidence": "medium"
}
```

`confidence` is `medium` because `W_q` carries meaning and the surrounding text does not define it.

A fragment, for contrast: the crop shows only `π_θ(o_i|q) / π_θold(o_i|q) · A_i, clip`, and
`context` holds `� min` and `, (1)` blocks beside it. The reply's `latex` is
`"\\frac{\\pi_\\theta(o_i \\mid q)}{\\pi_{\\theta_{\\mathrm{old}}}(o_i \\mid q)} A_i, \\operatorname{clip}"`,
with no `\left(`. The meaning is "Part of a larger formula (equation (1)): the ratio of the
current to the old policy's probability of output o_i, times A_i, then the start of a clip
term", followed by the lead-in's "the objective GRPO maximizes". q, o_i, π_θ, π_θold and
A_i are defined from the prose around it, and `confidence` is `low`.

Output only the JSON object. No prose, no code fences.
