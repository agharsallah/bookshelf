---
name: dissect-paper
description: Dissect a scientific paper on the Bookshelf into its paper card — a fixed shape every paper shares so cards compare side by side — a TL;DR, the research question, each contribution typed (method, result, theory, dataset, benchmark, position), the method with its diagram and key equations, the experimental setup (datasets, baselines, metrics), the headline results as tables and charts, stated and unstated limitations, assumptions, future work and the numbers worth remembering, all cited. Use for a paper_card (the dissect_paper stage, after every section is distilled) or when the user asks for a paper's card, dissection or structured summary, e.g. `/dissect-paper vaswani-attention`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `vaswani-attention`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/dissect-paper/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: agree on the TL;DR, the question and
   the contribution list first — they decide everything else — then write the card.
3. Write `{"skill": "dissect-paper", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/dissect-paper-<slug>.json`.
4. Import it; the server runs the same schema, anchor, grounding, length and coverage gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, word count). Approving the card marks the
   paper distilled and queues its explainer and other by-products.
<!-- interactive:end -->

# Dissect a paper

## Role

You write the **paper card**: the one page that says what a paper asks, what it contributes,
how it works, how it was tested, what it found and where it falls short. It replaces a book's
brief. Every paper gets **the same shape**, so a reader can put ten cards side by side and
compare questions, setups and results at a glance — never reorder, rename or drop a key, and
use an empty list where a paper has nothing for it.

Your input:
- `unit_distillations: [{anchor, heading, role, body}]` — every section's study note, in
  reading order, `body.blocks` already cited to the paper's blocks, with transcribed tables,
  charts, diagrams and equations. `role` is the section's part in the paper (`introduction`,
  `method`, `results`, …) or `null`.
- `abstract` — the authors' abstract as source blocks (`{anchor, blocks}`, citable), or as plain
  text (`{anchor: null, text}`, orientation only), or `null`.
- `paper_meta` — `doi`, `arxiv_id`, `venue`, `year`, `code_urls`, `data_urls`.

You are the stage that sees the whole paper at once. Your job is to **select and connect**: the
contributions the introduction promises, matched to the method that delivers them and the
results that support them.

## Method

1. **Read the abstract, then every distillation in order.** Note the problem, the gap the
   authors name, the idea, each contribution, the method's components, the setup, every
   headline number, and each limitation or caveat.
2. **`tldr`** — one or two sentences, at most 60 words: what the paper does and its main
   result, with the number when there is one ("A retrieval adapter that gates passages by
   question type, +2.1 EM over FiD-base on NQ with a 40% smaller adapter"). No hype words the
   paper does not use.
3. **`question`** — the research question or problem, as a question or a problem statement,
   with the gap the authors say existing work leaves.
4. **`contributions`** (1–8) — each as the authors claim it, typed by what it adds:
   `method` (a new model, algorithm or technique), `result` (an empirical finding),
   `theory` (a proof, bound or formal analysis), `dataset` (new data), `benchmark` (a new
   evaluation or task), `position` (an argument about how the field should work). Merge a
   contribution the introduction lists twice; keep the authors' strength of claim.
5. **`method`** (render blocks) — a `paragraph` overview of how it works; a `diagram` of the
   architecture or pipeline (merge the method distillation's diagrams; only components and
   flows a distillation states); the one to three **key equations** as `math` blocks copied
   from the distillations with their `meaning`; `steps` for the training or inference
   procedure. Depth for a reader who will reimplement it at a sketch level, not every detail.
6. **`setup`** — `datasets`, `baselines`, `metrics`: one `{name, spans}` each, `name` as the
   paper writes it ("WMT 2014 English-German", "BLEU"), the spans giving what matters (size and
   split; re-run or copied; how computed). A paper without experiments gives three empty lists.
7. **`results`** (render blocks) — the headline results: the main results `table` copied from
   the distillation (all rows, cells exact) or cut to the columns that carry the claim; a `chart`
   when comparable numbers make the point faster (copy values exactly); a `paragraph` or
   `bullets` stating each comparison the authors draw, with its size; ablations that change
   the conclusion; a `caution` callout for any gain within noise or reported without variance.
   A paper without experiments states its main theoretical results here in `paragraph`s.
8. **`limitations`** — `stated`: every limitation the authors state. `unstated`: gaps visible in
   the paper's own setup that the authors do not state — one language pair only, no variance
   reported, baselines copied rather than re-run, compute out of reach — each phrased as an
   observation of the setup and citing the passage that shows it ("Evaluated only on English–
   German and English–French translation"). Never speculate beyond what the setup shows; an
   `unstated` item with nothing in the paper to cite does not belong on the card.
9. **`assumptions`** — the premises the method or the evaluation rests on, stated or implicit
   in the setup (the data is i.i.d.; the metric reflects quality; a pretrained model is
   available), each citing where it shows.
10. **`future_work`** — directions the authors name, nothing else.
11. **`numbers`** (0–8) — the figures a reader should remember: headline scores, deltas, costs,
    sizes. `value` is the number alone with its unit as the paper gives it, under ten
    characters where possible ("28.4 BLEU", "+2.1 EM", "3.5 days", "8 GPUs"); `label` says
    what it measures and on what ("Test F1 on SQuAD v1.1, +1.5 over the best ensemble") and
    cites it — never where it was read ("from the abstract"): the cite says that.
12. **Length:** about 800–2,000 words in all spans, never more than 2,500. Spend them on the
    method and the results.
13. **Self-check:** all ten keys present; every contribution typed; every number copied from a
    distillation; every table and `latex` copied exactly; each unstated limitation cites the
    passage that shows the gap; the method and results sections' anchors are cited; every
    span cited; the JSON parses.

## Hard rules

1. **Only the given input.** Everything comes from the distillations and the abstract. You may
   recognise the paper; ignore what you know about it — no later results, follow-up work,
   citation counts, reputation or venue facts from your own knowledge.
2. **Every leaf span (`{text, cites}`) cites ≥ 1 anchor** that appears verbatim in the input:
   the block anchors inside the distillations' spans (`ch04/s02/t001`) or the abstract's block
   anchors. Cite a unit anchor (`unit_distillations[].anchor`) only for a claim about a whole
   section. Never construct, guess, renumber or shorten an anchor. Plain-text abstract (with
   `anchor: null`) is never cited and never the only source of a statement.
3. **Numbers are sacred.** Copy every number with its unit, precision and sign; never round,
   convert, or compute a difference the distillations do not state.
4. **Verbatim material is never paraphrased.** `math`, `code`, `quote` and transcribed `table`
   and `chart` blocks are copied from the distillation exactly, including their `cites`.
5. **The authors' claims stay theirs.** Keep their hedges; attribute interpretations ("the
   authors attribute the gain to…"). Your own judgement appears only in `limitations.unstated`
   and `assumptions`, and only as an observation the cited passage supports.
6. **Diagrams encode the distillations.** A component or edge no distillation states is an
   invented claim.
7. **Fixed shape.** Keys in the order of the schema, none renamed or added; an empty list, never
   a placeholder, where the paper has nothing.
8. **No meta-commentary** ("this paper presents…", "the card shows…"). State the content.
9. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic quotes;
   escape each backslash in `latex`.
10. **Thin input** (one short distillation, or mostly empty ones): fill the fixed shape from
    what exists and stop. Where a required list (`contributions`, `method`, `results`) cannot be
    supported, write the single span `"The distillations do not support this yet."` with
    `"cites": []`; the missing citation routes the card to review. Never pad.
11. Write in the language of the source.

## Output

One JSON object, keys in this order:
`{"tldr": spans, "question": spans, "contributions": [{"kind", "spans"}], "method": [blocks], "setup": {"datasets": [{"name", "spans"}], "baselines": [...], "metrics": [...]}, "results": [blocks], "limitations": {"stated": [spans], "unstated": [spans]}, "assumptions": [spans], "future_work": [spans], "numbers": [{"value", "label"}]}`.
A `spans` is a list of `{"text": "…", "cites": ["<anchor>"]}`; a list of spans (`stated`,
`assumptions`, …) holds one item per point.

## Example

Input (excerpt): `abstract` = `{"anchor": "fm01", "blocks": [{"anchor": "fm01/p002", "text": "We introduce gated retrieval adapters (GRA) …"}]}`; `unit_distillations` for `ch01` "1 Introduction" (role `introduction`: "readers attend to every retrieved passage equally, so irrelevant passages dilute the evidence" cites `ch01/p002`; contributions cite `ch01/p004`), `ch03` "3 Method" (role `method`: diagram of retriever → gate → reader cites `ch03/p001`, `ch03/s01/p002`; math `g_i = \sigma(w^\top [q; p_i])` cites `ch03/s01/m001`), `ch04` "4 Experiments" (role `experiments`: setup bullets cite `ch04/p001`, `ch04/s01/p002`; results table cites `ch04/s02/t001`; "+2.1 EM on NQ, +3.4 on HotpotQA, 40% fewer adapter parameters" cites `ch04/s02/p001`; TriviaQA within noise cites `ch04/s02/p002`), `ch05` "5 Conclusion" (limitation "the gate is trained per benchmark" cites `ch05/p002`; future work "share one gate across tasks" cites `ch05/p003`). Output (abridged):

```json
{
  "tldr": [
    {"text": "Gated retrieval adapters score each retrieved passage before the reader sees it, improving exact match over FiD-base by 2.1 points on NQ and 3.4 on HotpotQA with a 40% smaller adapter.", "cites": ["fm01/p002", "ch04/s02/p001"]}],
  "question": [
    {"text": "Can an open-domain QA reader stop irrelevant retrieved passages from diluting its evidence, without a larger model?", "cites": ["ch01/p002"]}],
  "contributions": [
    {"kind": "method", "spans": [{"text": "A learned gate that weights each passage by its relevance to the question before reading.", "cites": ["ch01/p004", "ch03/s01/p002"]}]},
    {"kind": "result", "spans": [{"text": "State-of-the-art EM among the compared readers on NQ and HotpotQA at a smaller adapter size.", "cites": ["ch01/p004", "ch04/s02/t001"]}]}
  ],
  "method": [
    {"type": "paragraph", "spans": [
      {"text": "A retriever returns passages; a small gate scores each one against the question; the reader attends to passages in proportion to their gate score.", "cites": ["ch03/p001", "ch03/s01/p002"]}]},
    {"type": "diagram", "direction": "LR", "nodes": [
      {"id": "q", "label": "Question"}, {"id": "ret", "label": "Retriever"}, {"id": "gate", "label": "Passage gate"}, {"id": "rd", "label": "Reader"}],
     "edges": [{"from": "q", "to": "ret"}, {"from": "ret", "to": "gate", "label": "passages"}, {"from": "gate", "to": "rd", "label": "weighted passages"}],
     "cites": ["ch03/p001", "ch03/s01/p002"]},
    {"type": "math", "latex": "g_i = \\sigma(w^\\top [q; p_i])", "meaning": [
      {"text": "The gate score of passage i is a sigmoid of a learned projection of the question and passage encodings, concatenated.", "cites": ["ch03/s01/m001"]}], "cites": ["ch03/s01/m001"]}
  ],
  "setup": {
    "datasets": [
      {"name": "Natural Questions", "spans": [{"text": "Open-domain QA, development set.", "cites": ["ch04/p001"]}]},
      {"name": "HotpotQA", "spans": [{"text": "Multi-hop QA needing evidence from two passages, development set.", "cites": ["ch04/p001", "ch04/s02/p001"]}]}],
    "baselines": [
      {"name": "FiD-base", "spans": [{"text": "Re-run with the authors' released code.", "cites": ["ch04/s01/p002"]}]}],
    "metrics": [
      {"name": "EM", "spans": [{"text": "Exact match of the predicted answer.", "cites": ["ch04/p001"]}]}]
  },
  "results": [
    {"type": "table", "caption": "EM on the development sets", "header": ["Model", "NQ", "HotpotQA"], "rows": [
      [{"text": "FiD-base", "cites": ["ch04/s02/t001"]}, {"text": "48.2", "cites": ["ch04/s02/t001"]}, {"text": "44.7", "cites": ["ch04/s02/t001"]}],
      [{"text": "GRA (ours)", "cites": ["ch04/s02/t001"]}, {"text": "50.3", "cites": ["ch04/s02/t001"]}, {"text": "48.1", "cites": ["ch04/s02/t001"]}]]},
    {"type": "callout", "tone": "caution", "spans": [
      {"text": "On TriviaQA the 0.3 EM lead is within the ±0.4 standard deviation over three seeds.", "cites": ["ch04/s02/p002"]}]}
  ],
  "limitations": {
    "stated": [[{"text": "The gate is trained separately for each benchmark.", "cites": ["ch05/p002"]}]],
    "unstated": [[{"text": "All results are on development sets; no test-set numbers are reported.", "cites": ["ch04/p001"]}]]
  },
  "assumptions": [[{"text": "Relevant passages are among those the retriever returns: the gate can only down-weight, not recover, evidence.", "cites": ["ch03/p001"]}]],
  "future_work": [[{"text": "Sharing one gate across tasks.", "cites": ["ch05/p003"]}]],
  "numbers": [
    {"value": "+2.1 EM", "label": [{"text": "Gain over FiD-base on Natural Questions", "cites": ["ch04/s02/p001"]}]},
    {"value": "+3.4 EM", "label": [{"text": "Gain over FiD-base on HotpotQA", "cites": ["ch04/s02/p001"]}]},
    {"value": "40% fewer", "label": [{"text": "Adapter parameters, compared with FiD-base", "cites": ["ch04/s02/p001"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
