---
name: extract-claims
description: Extract every claim a scientific paper on the Bookshelf makes — each as one self-contained sentence, typed (method, result, theory, dataset, benchmark, position), graded by strength (measured by the paper's own experiments, argued, or speculated) and cited to the passages it rests on — so the claim tracker can relate claims across papers (supports, contradicts, extends). Use for a paper's claim_set (queued once the paper card is approved) or when the user asks what a paper claims, e.g. `/extract-claims vaswani-attention`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `vaswani-attention`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/extract-claims/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below with the user: agree on the list of claims first, then on each one's
   kind and strength — those decide how the claim is compared with other papers.
3. Write `{"skill": "extract-claims", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/extract-claims-<slug>.json`.
4. Import it; the server runs the same schema, anchor, key, strength and coverage gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict. Approving the claim set writes its claims to the shelf's claim
   tracker, which then looks for related claims in other papers.
<!-- interactive:end -->

# Extract a paper's claims

## Role

You list **what the paper asserts**, one claim at a time, so each can be checked against the
claims of other papers on the shelf. A claim is a single statement a reader could agree or
disagree with: a method works in a stated way, a result holds on a stated benchmark, a bound
is proven, a dataset has stated properties, the field should do something. Another model will
later read your claim next to a claim from a different paper and decide whether one supports,
contradicts or extends the other — so every claim must stand on its own.

Your input:
- `unit_distillations: [{anchor, heading, role, body}]` — every section's study note, in
  reading order, `body.blocks` cited to the paper's blocks. `role` is the section's part in
  the paper (`introduction`, `method`, `experiments`, `results`, …) or `null`.
- `abstract` — the authors' abstract as source blocks (`{anchor, blocks}`, citable), as plain
  text (`{anchor: null, text}`, orientation only), or `null`.
- `paper_card` — the paper's card (TL;DR, typed contributions, setup, results, limitations),
  or `null`. Orientation: its contributions tell you what the authors consider central.
- `paper_meta` — `doi`, `arxiv_id`, `venue`, `year`, `code_urls`, `data_urls`.

## Method

1. **Read the card's contributions, the abstract, then every distillation in order.** Collect
   each assertion: what the method does and why it should work, every result the paper
   reports as a finding, every proven statement, every property of new data, every position.
2. **One claim, one sentence.** Split a sentence that asserts two things; merge the same
   assertion made in the abstract, the introduction and the results into one claim citing
   all of them. 5–25 claims for a typical paper; at most 40.
3. **Self-contained `text`.** Name the method, the dataset, the metric and the comparison
   explicitly: "The Transformer (big) reaches 28.4 BLEU on WMT 2014 English-German, above
   every previously reported model", never "Our model beats the baselines" or "It is faster".
   No "we", "our", "this paper": write the method's name. Copy numbers exactly with their
   units; keep the authors' hedges ("may", "suggests").
4. **`kind`** — `method` (how a technique works or why it helps), `result` (an empirical
   finding), `theory` (a proof, bound or formal property), `dataset` (properties of new data),
   `benchmark` (a new evaluation or task and what it measures), `position` (how the field
   should work).
5. **`strength`** — how the paper backs the claim:
   - `measured`: the paper's own experiments, tables, figures or data show it; cite the
     results, experiments or appendix passage, the table or the figure that shows it;
   - `argued`: supported by reasoning, a derivation, a proof, or other work the paper cites;
   - `speculated`: hedged, hypothesised, or stated as future work.
   Grade by the evidence in the paper, not by the authors' confidence: a result announced in
   the introduction but never measured is `argued` at most.
6. **`cites`** — every anchor that states or shows the claim (1–8): the block anchors inside the
   distillations' spans (`ch04/s02/t001`) or the abstract's block anchors. A measured claim
   cites where it is measured.
7. **`key`** — `C1`, `C2`, … in reading order of each claim's first cite, unique.
8. **Self-check:** keys unique and consecutive; no two claims say the same thing; every claim
   understandable without the paper; every number copied; every measured claim cites a
   results or experiments passage, a table or a figure; the JSON parses.

## Hard rules

1. **Only the given input.** Everything comes from the distillations, the abstract and the
   card. You may recognise the paper; ignore what you know about it — no later results,
   follow-up work or reputation.
2. **Every claim cites ≥ 1 anchor** that appears verbatim in the input. Cite a unit anchor
   (`unit_distillations[].anchor`) only for a claim a whole section makes. Never construct,
   guess, renumber or shorten an anchor. The plain-text abstract (`anchor: null`) is never cited.
3. **Numbers are sacred.** Copy every number with its unit, precision and sign; never round or
   compute a difference the input does not state.
4. **The authors' claims, not yours.** No judgement of whether a claim is true, no limitation
   the authors do not state, no claims about other papers except as this paper asserts them
   ("Recurrent models cannot be parallelised across positions" is a claim the paper makes).
5. **A measured claim cites its measurement**: a passage of a `results`, `experiments` or
   `appendix` unit (appendices hold extra ablations), a table (`t…`) or a figure (`f…`). If
   the input shows no measurement, it is `argued`.
6. **No meta-commentary** ("the paper claims that…"). State the claim itself.
7. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic quotes.
8. **Thin input** (one short distillation): extract the claims that exist and stop. Never pad.
9. Write in the language of the source.

## Output

One JSON object: `{"claims": [{"key": "C1", "text": str, "kind": "method" | "result" | "theory" |
"dataset" | "benchmark" | "position", "strength": "measured" | "argued" | "speculated", "cites":
["<anchor>"]}]}`.

## Example

Input (excerpt): `unit_distillations` for `ch01` "1 Introduction" (role `introduction`: "readers
attend to every retrieved passage equally, so irrelevant passages dilute the evidence" cites
`ch01/p002`), `ch03` "3 Method" (role `method`: the gate scores each passage against the question
cites `ch03/s01/p002`), `ch04` "4 Experiments" (role `experiments`: results table cites
`ch04/s02/t001`; "+2.1 EM on NQ, +3.4 on HotpotQA" cites `ch04/s02/p001`; TriviaQA within noise
cites `ch04/s02/p002`), `ch05` "5 Conclusion" (future work "share one gate across tasks" cites
`ch05/p003`). Output:

```json
{
  "claims": [
    {"key": "C1", "text": "Gating each retrieved passage by its relevance to the question before reading stops irrelevant passages from diluting the reader's evidence.", "kind": "method", "strength": "argued", "cites": ["ch01/p002", "ch03/s01/p002"]},
    {"key": "C2", "text": "Gated retrieval adapters improve exact match over FiD-base by 2.1 points on Natural Questions and 3.4 points on HotpotQA.", "kind": "result", "strength": "measured", "cites": ["ch04/s02/t001", "ch04/s02/p001"]},
    {"key": "C3", "text": "On TriviaQA, the 0.3 EM gain of gated retrieval adapters over FiD-base is within the standard deviation over three seeds.", "kind": "result", "strength": "measured", "cites": ["ch04/s02/p002"]},
    {"key": "C4", "text": "A single gate shared across tasks might remove the need to train one gate per benchmark.", "kind": "method", "strength": "speculated", "cites": ["ch05/p003"]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
