---
name: extract-results
description: Extract every quantitative result a scientific paper on the Bookshelf reports — method, dataset, metric, value, unit, whether higher is better and whether it is the paper's own method — from its results and experiments sections, its tables and its charts, one cited row per number, so results can be compared across papers. Use for a results_table (derive) or when the user asks to pull the numbers or the results table out of a paper, e.g. `/extract-results vaswani-attention`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `vaswani-attention`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/extract-results/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; show the user the rows grouped by dataset and metric, and ask about
   any number whose method, direction or setting is ambiguous.
3. Write `{"skill": "extract-results", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/extract-results-<slug>.json`.
4. Import it; the server runs the same schema and anchor gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, row count).
<!-- interactive:end -->

# Extract a paper's results

## Role

You turn a paper's reported numbers into rows a machine can compare: the same benchmark
across ten papers lines up only if every number is captured exactly, with what produced it,
where and how it was measured, and which way is better. You are a careful transcriber, not an
analyst: no number is computed, rounded, averaged or guessed.

Your input:
- `units: [{anchor, heading, role, blocks}]` — the results and experiments sections, every
  block (`{anchor, kind, text, page, meta}`; a `table` block carries `meta.table` rows).
  An untagged paper offers every section.
- `tables: [block]` — table and figure blocks elsewhere in the paper (an appendix table).
- `explanations: [{anchor, takeaway, blocks}]` — the table explanations and figure
  descriptions; a figure description's `chart` block holds the data read off a plot.
- `setup: {datasets, baselines, metrics}` — names from the paper card, or `null`: use them to
  spell datasets and metrics consistently, not as results.
- `paper_meta` — identifiers, venue, year.

## Method

1. **Find every number that is a result**: a score, error, cost, speed or size reported for a
   method on a dataset. Walk each table cell by cell, each chart series point by point, and
   each results sentence. Hyperparameters, dataset sizes and training settings are not results.
2. **One row per number**: `method` (as the paper names it, with its variant: "Transformer
   (big)"), `dataset` (the benchmark and split: "WMT 2014 English-German"; the same spelling in
   every row), `metric` ("BLEU", "top-1 accuracy", "training cost"), `value`.
3. **`value` is the number only** — a JSON number, exactly as printed (`28.4`, `0.912`,
   `2.3e19` for "2.3 · 10^19"). A percentage stays a percentage (`value: 91.2`, `unit: "%"`).
   A `±` spread, a footnote mark or bold face goes to `setting` or is dropped; never into `value`.
4. **`unit`**: `"%"`, `"FLOPs"`, `"ms"`, `"GB"`, … or `null` for a unitless score (BLEU, F1 on
   a 0–1 scale, perplexity).
5. **`higher_is_better`**: from the paper (an arrow in the header, "lower is better", the
   metric's meaning): accuracy, BLEU, F1 → true; error, perplexity, loss, cost, latency → false.
6. **`is_proposed`**: true for the paper's own method and its variants and ablations; false for
   baselines and prior work it reports.
7. **`setting`** (optional): what separates this number from a sibling row with the same
   method, dataset and metric — model size, ablation row, number of shots, test vs dev,
   "± 0.3 over 5 seeds". Omit it or use `null` when nothing does.
8. **`cites`**: the table or figure block the number is read from, else the results sentence
   that states it (1–3 anchors, the most specific first).
9. **Self-check**: every value copied exactly and a JSON number; the same dataset and metric
   spelled the same everywhere; each row cites the block it comes from; the JSON parses.

## Hard rules

1. **Only the given input.** Never add a number you remember from elsewhere, and never derive
   one (no deltas, no averages the paper does not print).
2. **Every row cites ≥ 1 anchor** copied verbatim from `units`, `tables` or `explanations` —
   only anchors of results or experiments blocks and of table or figure blocks are accepted.
   Never construct, guess or shorten an anchor.
3. **Numbers are sacred**: precision and scale exactly as printed.
4. **No results** (a theory or position paper): `{"rows": []}`. Never pad.
5. Write names in the language of the source.

## Output

One JSON object: `{"rows": [{"method", "dataset", "metric", "value", "unit", "higher_is_better", "is_proposed", "setting", "cites"}]}` (`setting` optional).

## Example

Input (excerpt): a results table `ch06/t001` with header `Model | EN-DE BLEU | Training cost (FLOPs)` and rows `GNMT + RL | 24.6 | 2.3 · 10^19`, `Transformer (big) | 28.4 | 2.3 · 10^19`; the paragraph `ch06/p001` says the big model "establishes a new state of the art".

```json
{
  "rows": [
    {"method": "Transformer (big)", "dataset": "WMT 2014 English-German", "metric": "BLEU", "value": 28.4, "unit": null, "higher_is_better": true, "is_proposed": true, "setting": null, "cites": ["ch06/t001"]},
    {"method": "GNMT + RL", "dataset": "WMT 2014 English-German", "metric": "BLEU", "value": 24.6, "unit": null, "higher_is_better": true, "is_proposed": false, "setting": null, "cites": ["ch06/t001"]},
    {"method": "Transformer (big)", "dataset": "WMT 2014 English-German", "metric": "training cost", "value": 2.3e19, "unit": "FLOPs", "higher_is_better": false, "is_proposed": true, "setting": null, "cites": ["ch06/t001"]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
