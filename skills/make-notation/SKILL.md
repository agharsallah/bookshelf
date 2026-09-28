---
name: make-notation
description: Build the notation table of a scientific paper on the Bookshelf — every symbol its formulas use, listed once in order of first use, with its meaning as the paper defines it (shape or domain when stated), the block that first uses it and the blocks that define it — from the paper's formulas, the prose around them and their describe-math explanations. It sits beside the reader in the second pass. Use for a notation_table (derive) or when the user asks what the symbols in a paper mean, e.g. `/make-notation vaswani-attention`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `vaswani-attention`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-notation/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.
   A paper without formulas has no input: the call answers 422.)
2. Do the work below; show the user the table and ask about any symbol whose meaning the
   paper leaves implicit before you guess at it (leave it out rather than guess).
3. Write `{"skill": "make-notation", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-notation-<slug>.json`.
4. Import it; the server runs the same schema, anchor, first-use and duplicate gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, number of symbols).
<!-- interactive:end -->

# Build a paper's notation table

## Role

You compile the notation table a careful reader keeps beside a paper: every symbol, what it
stands for, and where it first appears, so they never have to hunt back through the paper for
"what was `d_k` again?". You record the paper's own definitions — you do not explain the maths.

Your input:
- `blocks: [{anchor, kind, text, page, meta}]` — the paper's formulas (`kind: "math"`, the
  LaTeX in `meta.latex` when parsed, else in `text`) and the prose just before and after each
  one, **in reading order**. This order decides "first".
- `math_descriptions: [{anchor, takeaway, blocks}]` — explanations of some formulas (the anchor
  is the formula's), often naming each symbol. Their cites are formula or prose anchors.
- `distilled_formulas: [{latex, meaning, cites}]` — formulas the paper writes **inline in
  prose** (`C ∈ R^H`, `s_null = S·C + E·C`), as the section notes wrote them out in LaTeX;
  `cites` are the prose blocks (in `blocks`) that state them. Their symbols count like any
  formula's: take `symbol_latex` from this LaTeX, the meaning from the cited prose.

## Method

1. **Walk `blocks` in order.** For each formula (a `math` block, or a prose block a
   `distilled_formulas` entry cites), list the symbols it uses: variables,
   indexed quantities (`p_i`), matrices and vectors (`\mathbf{W}^Q`), functions and operators
   the paper defines or names (`\sigma`, `\mathrm{Attention}`), sets and constants with a
   paper-specific meaning. Skip generic mathematics (`+`, `\sum`, `\exp`, `\log`, `\cdot`,
   indices like `i` used only as a counter) unless the paper gives them a special meaning.
2. **One entry per symbol.** `symbol_latex` as the paper writes it, without `$` delimiters,
   in its simplest form (`d_k`, not `{d}_{k}`); a symbol that appears with and without an index
   (`p` and `p_i`) is one entry, under the form the paper defines. Spelling variants of one
   symbol are one entry.
3. **`meaning`** (≤ 300 characters) — what it denotes, from the prose ("where `d_k` is the
   dimension of the keys"), the formula's explanation or the formula itself; add its shape,
   domain or range when the paper states it ("a d_model × d_k matrix", "between 0 and 1").
   A symbol the input never defines or explains is left out — never supply a textbook meaning.
4. **`first_anchor`** — the **first block in `blocks`** (reading order) whose text or LaTeX
   uses the symbol. Prose that introduces a symbol before its formula ("let q be the question
   encoding") counts.
5. **`cites`** (≥ 1) — the blocks that define or use it, in reading order: the defining
   prose, the formulas, and the explanation's formula anchor. Only anchors from `blocks`, and
   **none earlier than `first_anchor`**.
6. **Order** the entries by `first_anchor` in reading order.
7. **Self-check:** no symbol twice; every `first_anchor` is a `blocks` anchor and no cite of
   the entry comes before it; every meaning is stated in the input; the JSON parses.

## Hard rules

1. **Only the given input.** Meanings come from the blocks and the explanations. You may know
   the paper's notation from elsewhere; use only what this input states.
2. **Anchors from `blocks` only.** `first_anchor` and every cite appear verbatim in `blocks`.
   Never construct, guess or shorten an anchor.
3. **First means first.** `first_anchor` is the earliest block that uses the symbol, and every
   cite is that block or a later one.
4. **No duplicates.** One entry per symbol, however many formulas use it.
5. **LaTeX copied, not invented.** `symbol_latex` is written as the paper writes the symbol;
   escape each backslash in JSON (`"\\sigma"`).
6. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic quotes.
7. **Few symbols** (one or two formulas): list what exists. Never pad; `{"symbols": []}` when
   no symbol is defined anywhere in the input.
8. Write `meaning` in the language of the source.

## Output

One JSON object:
`{"symbols": [{"symbol_latex", "meaning", "first_anchor", "cites": ["<anchor>"]}]}`.

## Example

Input (excerpt): `blocks` = `ch03/s01/p001` (paragraph: "Let q be the encoding of the question
and p_i that of the i-th retrieved passage."), `ch03/s01/m001` (math, `meta.latex`
`g_i = \sigma(w^\top [q; p_i])`), `ch03/s01/p002` (paragraph: "where w is a learned vector and
σ the logistic function, so each gate score g_i lies between 0 and 1."). Output:

```json
{
  "symbols": [
    {"symbol_latex": "q", "meaning": "Encoding of the question.", "first_anchor": "ch03/s01/p001", "cites": ["ch03/s01/p001", "ch03/s01/m001"]},
    {"symbol_latex": "p_i", "meaning": "Encoding of the i-th retrieved passage.", "first_anchor": "ch03/s01/p001", "cites": ["ch03/s01/p001", "ch03/s01/m001"]},
    {"symbol_latex": "g_i", "meaning": "Gate score of passage i, between 0 and 1.", "first_anchor": "ch03/s01/m001", "cites": ["ch03/s01/m001", "ch03/s01/p002"]},
    {"symbol_latex": "w", "meaning": "Learned projection vector of the gate.", "first_anchor": "ch03/s01/m001", "cites": ["ch03/s01/m001", "ch03/s01/p002"]},
    {"symbol_latex": "\\sigma", "meaning": "The logistic sigmoid.", "first_anchor": "ch03/s01/m001", "cites": ["ch03/s01/m001", "ch03/s01/p002"]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
