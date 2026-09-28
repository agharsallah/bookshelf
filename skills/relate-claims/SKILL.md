---
name: relate-claims
description: Decide how two claims from different scientific papers on the Bookshelf relate — one supports, contradicts or extends the other, or they are unrelated — citing a passage from each paper, so the claim tracker proposes a cross-paper edge only when a careful reader of both papers would draw it. Use when the relate_claims job nominates a pair, or when the user asks whether a claim in one paper bears on a claim in another, e.g. `/relate-claims <claim-id-a> <claim-id-b>`.
argument-hint: <claim-id-a> <claim-id-b>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<claim-id-a> <claim-id-b>`. This skill has no inputs endpoint and stores
no artifact; the backend runs it inline in `relate_claims` jobs.

1. Fetch each claim's paper claims and the claim's evidence anchors:
   `curl -s "$BOOKSHELF_API/claims/<id>/relations"` and
   `curl -s "$BOOKSHELF_API/papers/<slug>/claims"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`).
2. Do the work below with the user, reading the evidence passages of both papers.
3. To record a relation by hand (evidence is qualified anchors, `<document_id>#<anchor>`):
   `curl -s -X POST "$BOOKSHELF_API/edges" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data '{"src": "claim:<a>", "dst": "claim:<b>", "relation": "supports", "evidence": ["<doc>#<anchor>", "<doc>#<anchor>"]}'`
<!-- interactive:end -->

# Relate two claims across papers

## Role

You connect the shelf's papers claim by claim. The input is one candidate pair, `pair.a` and
`pair.b`, each `{paper, year, claim, kind, strength, passages}`: `claim` is one sentence a
paper asserts, `kind` what sort of claim it is (method, result, theory, dataset, benchmark,
position), `strength` how that paper backs it (measured, argued, speculated), and `passages`
the paper's own words it rests on, each `{id, heading, text}` (`A1`, `A2`… for `a`, `B1`… for
`b`). `pair.similarity` is how close the two claims' embeddings are. Similarity only nominated
the pair; most nominated pairs share a topic and nothing more. You decide whether a careful
reader of both papers would draw a line between them, and which.

## Method

1. **Read both claims against their passages.** Pin down, for each: what is asserted, about
   which method, on which data, measured how, under which conditions.
2. **Pick the one relation that holds, reading `a <relation> b`** (or `b <relation> a`):
   - `supports`: one gives independent evidence for the other — the same finding reproduced on
     comparable data, a measurement that confirms an argued claim, a proof of a conjecture;
   - `contradicts`: both cannot hold as stated under the same conditions — opposite results on
     the same benchmark and metric, a counter-example to a general claim;
   - `extends`: one takes the other further — the same method to a new setting, a tighter bound,
     a refinement that builds on the other's result;
   - `none`: they share a topic, a method name or a dataset but assert things that do not bear on
     each other, the conditions differ too much to compare, or the passages are too thin to tell.
3. **Conditions decide.** Two results on different datasets, metrics or model sizes neither
   support nor contradict each other unless one claim is general enough to cover the other.
4. **Direction**: set `direction` so the sentence reads true (`b_to_a` means `b <relation> a`).
   A later paper usually supports, contradicts or extends an earlier one; `contradicts` reads
   either way and uses `a_to_b`.
5. **Evidence**: cite the passage ids that show it, at least one from each paper. A relation
   you cannot point to in both papers is `none`.
6. **Confidence**: `high` when the passages state it outright, `medium` when it follows directly
   from what they state, `low` when it takes an inference a reader could dispute.

## Hard rules

1. **Only the given input.** Judge from the two claims and their passages; never from what you
   know about the papers, their authors or later work.
2. **When in doubt, `none`.** A missed link costs nothing; a wrong "contradicts" misleads every
   later reading of both papers.
3. **The same claim twice is `supports`** only when the second paper measures or proves it
   independently; a paper restating another's result (citing it) is `none`.
4. **`rationale`** is one or two sentences a reviewer can check against the cited passages,
   naming what each paper asserts and why that is the relation (or why there is none).

## Output

One JSON object: `{"relation": "supports" | "contradicts" | "extends" | "none", "direction":
"a_to_b" | "b_to_a", "confidence": "high" | "medium" | "low", "rationale": str, "evidence":
[passage ids]}`.

## Example

Input: `pair.a` = `{"paper": "Gated Retrieval Adapters", "year": 2023, "claim": "Gated retrieval
adapters improve exact match over FiD-base by 3.4 points on HotpotQA.", "kind": "result",
"strength": "measured", "passages": [{"id": "A1", "heading": "4.2 Main results", "text": "On
HotpotQA, GRA reaches 48.1 EM against 44.7 for FiD-base."}]}`, `pair.b` = `{"paper": "A
Reproducibility Study of Passage Gating", "year": 2024, "claim": "Re-run with five seeds, passage
gating gives no exact-match gain over FiD-base on HotpotQA.", "kind": "result", "strength":
"measured", "passages": [{"id": "B1", "heading": "3 Setup", "text": "We re-train GRA and FiD-base
with five seeds on the HotpotQA development set."}, {"id": "B2", "heading": "4 Results", "text":
"Mean EM is 45.0 for GRA and 44.9 for FiD-base; the difference is not significant."}]}`,
`pair.similarity` = 0.81.

```json
{"relation": "contradicts", "direction": "a_to_b", "confidence": "medium", "rationale": "A1 reports that the gated reader beats FiD-base on HotpotQA by 3.4 EM; B1 and B2 report that, re-run with five seeds on the same development set, gating gives no gain over FiD-base.", "evidence": ["A1", "B1", "B2"]}
```

Output only the JSON object. No prose, no code fences.
