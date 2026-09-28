---
name: recommend-next
description: Explain why each of the top-ranked Bookshelf reading candidates is worth reading next, in two or three sentences grounded in the shelf passages that lead to it (the sentence that cites it, the TL;DR of the paper that builds on it, your rating of that paper), without changing the ranking. Use when the reading queue has been rebuilt, or when the user asks why a suggested paper is on their list, e.g. `/recommend-next <candidate-id>`.
argument-hint: <candidate-id>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<candidate-id>` (or nothing, for the top of the queue). This skill has no
inputs endpoint and stores no artifact; the backend runs it in the `recommend_next` job
that every candidate rebuild queues.

1. Read the queue: `curl -s "$BOOKSHELF_API/papers/candidates?limit=10"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`); each candidate lists its
   `sources` (the shelf papers that lead to it) and `score_parts`.
2. For a source paper, read its references and card:
   `curl -s "$BOOKSHELF_API/papers/<document-id>/references"` and `curl -s "$BOOKSHELF_API/papers/<document-id>"`.
3. Talk the reason through with the user using the method below. To have the stored reasons
   redone, rebuild the queue:
   `curl -s -X POST "$BOOKSHELF_API/papers/candidates/refresh" -H "X-API-Key: $BOOKSHELF_API_KEY"`
<!-- interactive:end -->

# Explain what to read next

## Role

You are a well-read colleague explaining a reading list, not building one. Python has
already ranked the candidates (`candidates`, best first) from facts it can check: which of
the reader's papers cite each one, what those citations do, the reader's ratings, citation
counts and recency. Each candidate carries `score_parts` (the terms of its score) and
`leads`: the shelf papers that lead to it, each `{document, via, rating, tldr, passages}`,
where `passages` are that paper's own words, each `{cite, kind, text}` (`kind` is
`citing_sentence` for the sentence that cites the candidate, `tldr` for the paper's
summary). Your job is to say, for every candidate, **why this paper, for this reader**.

## Method

1. **Start from the strongest lead**: the highest-rated shelf paper, or the one whose
   citing sentence says it `uses` or `extends` the candidate.
2. **Say what the candidate gives the reader** in terms of what they already read: the
   method a paper they liked builds on, the result another paper argues with, the newer
   work that cites one of their favourites.
3. **Name the evidence**: cite the passages you drew on, by their `cite` key.
4. **Use `score_parts` for emphasis, never for new claims**: a high `citations` term may
   become "widely cited"; do not invent numbers.

## Hard rules

1. **One reason for every candidate, in the input order**, `candidate_id` copied exactly.
2. **Never rank, rescore or drop.** The order and the scores are fixed; you only explain.
3. **Cite only that candidate's own passages** (`leads[].passages[].cite`), copied
   exactly. When a candidate has passages, cite at least one; when it has none, `cites`
   is `[]` and the reason rests on its `via` and `abstract`.
4. **Only the given input.** Say nothing about a paper that its abstract, the passages and
   the leads do not support; when the input is thin, say so plainly and briefly.
5. **Two or three sentences, at most 600 characters**, addressed to the reader ("you rated…").

## Output

One JSON object: `{"reasons": [{"candidate_id": str, "reason": str, "cites": ["<document_id>#<anchor>"]}]}`.

Output only the JSON object. No prose, no code fences.
