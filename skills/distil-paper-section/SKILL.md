---
name: distil-paper-section
description: Distil one top-level section of a scientific paper on the Bookshelf into an in-depth, cited, role-aware study note — for an introduction the problem, the gap and each contribution; for a method the setup, datasets, baselines, metrics, hyperparameters and every equation as math blocks; for results every number, with tables and charts transcribed exactly; for related work a positioning map of the lines of work the paper sets itself against. Use for a paper unit's chapter_distillation (the distil_paper_section stage) or when the user asks to distil a section of a paper, e.g. `/distil-paper-section vaswani-attention ch03`.
argument-hint: <document-slug> <unit-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <unit-anchor>`, for example `vaswani-attention ch03`. A unit is
a top-level section of the paper (`ch01`, `ch02`, …); the abstract and the references are not
units.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/distil-paper-section/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: first say what the section's `role`
   asks you to keep (the setup list of a method, the numbers of a results section, …) and
   agree on it, then write the blocks; revise on request.
3. Write `{"skill": "distil-paper-section", "document": "<slug>", "anchor": "<inputs.scope.anchor>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/distil-paper-section-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor, grounding and compression gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, compression ratio).
<!-- interactive:end -->

# Distil a paper section

## Role

You write the **study note for one top-level section of a scientific paper**, for a reader
who wants to understand and reuse this work without rereading the section. The note is the
paper's deepest layer of knowledge: the paper card, the claims, the results table, the
explainer and every study aid are built from these notes later, so a setting, a baseline or a
number you leave out is lost to all of them.

A paper is not a book. It says each thing once, densely, and its value is in the specifics: the
exact setup, the exact numbers, the exact equation. So you drop far less than a book
distiller would. What you drop is the prose around the specifics — motivation repeated from
the introduction, signposting ("in this section we…"), and hedged restatements.

Your input:
- `scope` — this section (`anchor`, `heading`); `role` — what it does in the paper, one of
  `introduction, related_work, background, method, experiments, results, discussion,
  limitations, conclusion, appendix, other`, or `null` when the paper was not tagged (then
  judge the role from the content).
- `blocks` — every block of the section, in reading order (paragraphs, lists, tables, figures,
  code, formulas; a formula's LaTeX is in `meta.latex`, a table's cells in `meta`);
  `subsections` — the headings inside it (`{anchor, heading}`: a block belongs to the
  subsection whose anchor starts its own).
- `figures` — checked explanations of the section's figures, tables, code and formulas
  (`{anchor, takeaway, blocks}`, with transcribed chart data and tables).
- `references` — the bibliography entries cited in this section (`{ordinal, raw}`), so a
  marker such as `[12]` can be named.
- `paper` — `outline` (every unit's heading and role) and `abstract` (plain text). These are
  **orientation only**: they tell you where this section sits; they are never evidence.

## Method

1. **Read everything once** — `blocks` in order with `subsections`, then `figures`. Identify the
   section's role and what the rest of the paper will need from it.
2. **Keep, by role** (a section can mix roles — apply each part that fits):
   - **introduction** — the problem and why it matters; the **gap** (what existing work cannot
     do, as the authors state it); the idea in one or two sentences; **every contribution the
     authors list**, one bullet each; the headline results they claim, with their numbers.
   - **related_work / background** — a **positioning map**: a `table` with the header
     `["Line of work", "Representative works", "How this paper differs"]`, one row per line of
     work, naming works from `references` (first author and year, or the title, as the entry
     gives it) and the difference **the authors state**; background definitions as `definition`
     blocks and the equations it introduces as `math` blocks.
   - **method** — the architecture or algorithm as a `diagram` (components and the data flow the
     text states) and as `steps` when there is a procedure; **every equation** as a `math` block
     with `meaning` spans that say what each symbol is and what the equation does; design
     choices with the reason given for each; complexity or cost statements with their numbers.
   - **experiments** — the **setup**, complete: datasets (with size, splits, preprocessing),
     baselines (and whether re-run or copied from prior work), metrics (and how computed),
     hyperparameters (every value: learning rate, batch size, steps, schedule, dropout,
     hardware, training time) — a `table` for hyperparameters when there are more than four.
   - **results** — **every number**: transcribe each results table as a `table` (cells copied
     exactly) and add a `chart` when a set of comparable numbers carries the argument (a
     `bar` chart of methods on one metric, a `line` chart of a sweep); state each comparison the
     authors draw, with its size ("+2.1 EM over FiD-base"); ablations with what each removal
     costs; variance, seeds and significance as stated; where a gain is within noise, say so in
     a `caution` callout.
   - **discussion / limitations / conclusion** — interpretations the authors offer, each
     marked as theirs; stated limitations as `caution` callouts; future work as `question`
     callouts; the concluding claim.
   - **appendix** — proofs as `steps` of the argument with their `math`; extra settings and
     tables as for experiments and results.
3. **Drop only:** motivation repeated from elsewhere, signposting, transitions, generic praise
   of the field, and a second telling of the same point.
4. **Use the figures.** Copy chart, table and diagram blocks from `figures[].blocks` unchanged
   when they transcribe the structure you need; cite the figure's anchor. A figure the text
   leans on without an explanation in `figures` is described only as far as the text describes it.
5. **Choose the block that fits:** `paragraph` for an explanation of why; `bullets` for
   parallel items (contributions, datasets, findings); `steps` for a procedure or a proof;
   `table` for a setup or a comparison; `chart` for comparable numbers; `diagram` for an
   architecture or a pipeline; `math` for an equation; `definition` for a term the section
   defines; `code` for a listing; `heading` level 3 for the section's own subsections (never
   repeat the section title).
6. **Callouts** — up to six: `important` for the section's central claim, `remember` for a
   number or rule to recall cold, `caution` for a stated limit or a gain within noise,
   `contrast` for a difference the authors draw against prior work, `insight` for a
   non-obvious consequence the authors point out, `question` for an open question or future
   work, `antipattern` for a practice the authors show fails.
7. **Cite** every span with the most specific block anchor(s) it came from.
8. **Length, by role:** related work 20–40% of the words in `blocks`, introduction 25–45%,
   method 40–70%, experiments and results 45–80% (numbers are kept, not condensed), others
   30–55%. Shorter means a setting, a baseline or a number is missing.
9. **Self-check** before answering: every contribution, dataset, baseline, metric,
   hyperparameter and reported number the section states is in the note; every table cell and
   every `latex` copied exactly; every span cited with an anchor from the input; nothing taken
   from the abstract, the outline or your own knowledge; the JSON parses.

## Hard rules

1. **Only this section.** Use only `blocks`, `figures` and `references`. You may recognise the
   paper; ignore what you know about it. No facts, numbers, names, later results or follow-up
   work from your own knowledge, and never present outside knowledge as the paper's claim.
   `paper.abstract` and `paper.outline` are orientation: never state or cite anything from them.
2. **Every leaf span (`{text, cites}`) cites ≥ 1 anchor**, and every `chart`, `diagram`,
   `table`, `code`, `math` and `quote` block has non-empty `cites`.
3. **Cite the most specific block** — the paragraph, table, formula or figure that states it,
   never the section anchor when a block supports the span. A named reference cites the block
   where its marker appears (bibliography entries have no anchor to cite).
4. **Never invent anchors.** Cite only anchors that appear verbatim in `blocks[].anchor`,
   `figures[].anchor` or inside `figures[].blocks`. Never construct, guess or renumber one.
5. **Numbers are sacred.** Copy every number with its unit, precision and sign exactly as
   written ("28.4 BLEU", "3.5 days", "−0.3"); never round, convert, average or compute a
   difference the paper does not state. A chart uses only values the text or a table gives.
6. **Verbatim material is never paraphrased.** `math.latex` is the block's `meta.latex` (or its
   text) character for character; table cells, `code.text` and `quote.text` are copied exactly;
   `quote.page` is that block's `page`. If you cannot copy it exactly, describe it in a cited
   span instead.
7. **Keep the authors' strength of claim.** "We hypothesise", "suggests" and "we observe" stay
   as weak as written; a claim the authors attribute to prior work stays attributed.
8. **Diagrams encode the text.** A component or connection the section does not state is an
   invented claim.
9. **No meta-commentary** ("this section describes…"). State the content.
10. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic quotes.
    In `latex`, escape each backslash (`\\frac`).
11. **Thin or garbled input** (only headings, a few words, scrambled extraction): distil what is
    legible and stop; if nothing is, return `{"blocks": []}`. Never pad.
12. Write in the language of the source.

## Output

One JSON object: `{"blocks": [...]}` of render blocks. Open with the section's central claim
— a `paragraph` or an `important` callout — then follow the role's order above, with diagrams
and tables next to the text they depict.

Block shapes (text always lives in spans):
`{"type": "paragraph", "spans": [{"text": "…", "cites": ["<anchor>"]}]}` ·
`{"type": "bullets", "items": [[{"text": "…", "cites": ["<anchor>"]}], …]}` (`steps` alike) ·
`{"type": "math", "latex": "…", "meaning": [spans], "cites": ["<anchor>"]}` ·
`{"type": "table", "header": ["…", "…"], "rows": [[{"text": "…", "cites": ["<anchor>"]}, …]]}` ·
`{"type": "chart", "kind": "bar", "title": "…", "x": {"label": "…", "values": ["A", "B"]}, "y": {"label": "…"}, "series": [{"name": "…", "values": [1.0, 2.0]}], "cites": ["<anchor>"]}` ·
`{"type": "diagram", "direction": "LR", "nodes": [{"id": "a", "label": "…"}], "edges": [{"from": "a", "to": "b", "label": "…"}], "cites": ["<anchor>"]}` ·
`{"type": "callout", "tone": "caution", "spans": [...]}`.

## Example

Input (excerpt of a ~420-word experiments section): `scope` = `{"anchor": "ch04", "kind": "chapter", "heading": "4 Experiments"}`, `role` = `"experiments"`,
`subsections` = `[{"anchor": "ch04/s01", "heading": "4.1 Setup"}, {"anchor": "ch04/s02", "heading": "4.2 Main results"}]`; `blocks` include
`ch04/p001` "We evaluate GRA on three open-domain QA benchmarks — Natural Questions (NQ), TriviaQA and HotpotQA — and report exact match (EM) on their development sets.",
`ch04/s01/p001` "All readers use a 12-layer encoder with hidden size 768. We train for 40k steps with AdamW, a learning rate of 3e-5 with linear decay, and batch size 64 on 8 A100 GPUs, which takes about 11 hours.",
`ch04/s01/p002` "We compare against BM25+Reader [4], DPR [11] and FiD-base [9], all re-run with the authors' released code.",
`ch04/s02/t001` (table, `meta.header` ["Model", "NQ", "TriviaQA", "HotpotQA"], rows "BM25+Reader | 32.6 | 52.4 | 38.1", "DPR | 41.5 | 56.8 | 40.2", "FiD-base | 48.2 | 65.0 | 44.7", "GRA (ours) | 50.3 | 65.3 | 48.1"),
`ch04/s02/p001` "GRA improves EM by 2.1 points on NQ and 3.4 on HotpotQA over FiD-base, with an adapter of 40% fewer parameters. The largest gain is on HotpotQA, which needs evidence from two passages.",
`ch04/s02/p002` "On TriviaQA the difference to FiD-base (0.3 EM) is within the standard deviation over three seeds (±0.4)."
`references` include `{"ordinal": 9, "raw": "Izacard, G. and Grave, E. Leveraging passage retrieval with generative models for open domain question answering. EACL 2021."}`.

```json
{
  "blocks": [
    {"type": "callout", "tone": "important", "spans": [
      {"text": "GRA beats every baseline on all three benchmarks, clearly on NQ (+2.1 EM) and HotpotQA (+3.4 EM) over FiD-base, with a 40% smaller adapter.", "cites": ["ch04/s02/p001", "ch04/s02/t001"]}]},
    {"type": "heading", "level": 3, "text": "Setup"},
    {"type": "bullets", "items": [
      [{"text": "Datasets: ", "cites": ["ch04/p001"], "mark": "strong"}, {"text": "Natural Questions (NQ), TriviaQA and HotpotQA, open-domain QA, evaluated on the development sets.", "cites": ["ch04/p001"]}],
      [{"text": "Metric: ", "cites": ["ch04/p001"], "mark": "strong"}, {"text": "exact match (EM).", "cites": ["ch04/p001"]}],
      [{"text": "Baselines: ", "cites": ["ch04/s01/p002"], "mark": "strong"}, {"text": "BM25+Reader, DPR and FiD-base (Izacard and Grave, EACL 2021), all re-run with the authors' released code.", "cites": ["ch04/s01/p002"]}]]},
    {"type": "table", "caption": "Training configuration", "header": ["Setting", "Value"], "rows": [
      [{"text": "Reader encoder", "cites": ["ch04/s01/p001"]}, {"text": "12 layers, hidden size 768", "cites": ["ch04/s01/p001"]}],
      [{"text": "Optimiser", "cites": ["ch04/s01/p001"]}, {"text": "AdamW, learning rate 3e-5, linear decay", "cites": ["ch04/s01/p001"]}],
      [{"text": "Steps / batch size", "cites": ["ch04/s01/p001"]}, {"text": "40k / 64", "cites": ["ch04/s01/p001"]}],
      [{"text": "Hardware / time", "cites": ["ch04/s01/p001"]}, {"text": "8 A100 GPUs, about 11 hours", "cites": ["ch04/s01/p001"]}]]},
    {"type": "heading", "level": 3, "text": "Main results"},
    {"type": "table", "caption": "EM on the development sets", "header": ["Model", "NQ", "TriviaQA", "HotpotQA"], "rows": [
      [{"text": "BM25+Reader", "cites": ["ch04/s02/t001"]}, {"text": "32.6", "cites": ["ch04/s02/t001"]}, {"text": "52.4", "cites": ["ch04/s02/t001"]}, {"text": "38.1", "cites": ["ch04/s02/t001"]}],
      [{"text": "DPR", "cites": ["ch04/s02/t001"]}, {"text": "41.5", "cites": ["ch04/s02/t001"]}, {"text": "56.8", "cites": ["ch04/s02/t001"]}, {"text": "40.2", "cites": ["ch04/s02/t001"]}],
      [{"text": "FiD-base", "cites": ["ch04/s02/t001"]}, {"text": "48.2", "cites": ["ch04/s02/t001"]}, {"text": "65.0", "cites": ["ch04/s02/t001"]}, {"text": "44.7", "cites": ["ch04/s02/t001"]}],
      [{"text": "GRA (ours)", "cites": ["ch04/s02/t001"]}, {"text": "50.3", "cites": ["ch04/s02/t001"]}, {"text": "65.3", "cites": ["ch04/s02/t001"]}, {"text": "48.1", "cites": ["ch04/s02/t001"]}]]},
    {"type": "chart", "kind": "bar", "title": "EM on HotpotQA", "x": {"label": "Model", "values": ["BM25+Reader", "DPR", "FiD-base", "GRA"]},
     "y": {"label": "EM"}, "series": [{"name": "HotpotQA", "values": [38.1, 40.2, 44.7, 48.1]}], "cites": ["ch04/s02/t001"]},
    {"type": "paragraph", "spans": [
      {"text": "The largest gain is on HotpotQA, the benchmark that needs evidence from two passages.", "cites": ["ch04/s02/p001"]}]},
    {"type": "callout", "tone": "caution", "title": "TriviaQA is a tie", "spans": [
      {"text": "On TriviaQA GRA leads FiD-base by 0.3 EM, within the ±0.4 standard deviation over three seeds.", "cites": ["ch04/s02/p002"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
