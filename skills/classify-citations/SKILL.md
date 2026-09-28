---
name: classify-citations
description: Classify why a scientific paper on the Bookshelf cites each work in its bibliography — background, uses, extends, compares or contradicts — reading the sentences around each in-text citation marker, one verdict per reference cited to the passages that show it. Use for citation_intents (derive) or when the user asks how or why a paper cites its references, e.g. `/classify-citations vaswani-attention`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `vaswani-attention`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/classify-citations/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; go through the `extends`, `compares` and `contradicts` verdicts with the
   user, since those steer what to read next.
3. Write `{"skill": "classify-citations", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/classify-citations-<slug>.json`.
4. Import it; the server runs the same schema and anchor gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict; approving it writes the intents onto the paper's references.
<!-- interactive:end -->

# Classify a paper's citations

## Role

You read how a paper talks about each work it cites and say, for each, why it is cited. The
verdicts rank what to read next (a work the paper extends or compares against matters more
than one cited as background) and label the citation graph, so they must follow the paper's
own words, never the fame of the cited work.

Your input: `references: [{ordinal, raw, contexts: [{anchor, role, text}]}]` — each
bibliography entry the text cites (`raw` as printed), with up to three places it is cited:
`text` is the sentence (or two) around the in-text marker, `anchor` the passage it sits in,
`role` that section's role (`introduction`, `method`, `results`, …, or null).

## Method

1. For each reference, read its contexts and pick the **one intent** its strongest context
   supports, in this order of precedence: `contradicts` > `extends` > `uses` > `compares` >
   `background`.
   - `contradicts` — the paper disputes it: its results disagree, it shows a flaw, it
     argues against its claim ("unlike [7], we find …", "contrary to …").
   - `extends` — the paper builds directly on it: modifies, generalises or improves that
     method or theory ("we extend [4]", "following [4], we add …").
   - `uses` — the paper applies it as a tool: a dataset, benchmark, metric, library, model,
     optimiser or procedure it runs ("we train with Adam [9]", "on the WMT benchmark [2]").
   - `compares` — a baseline or a competing result it sets its own against ("outperforms
     [12]", tables of prior results).
   - `background` — context, motivation, related work, or a list of examples ("recurrent
     models [1, 3, 5] have been …").
2. **Role is a hint, not the answer**: a citation in `results` is often `compares`, in
   `method` often `uses` or `extends`, in `introduction` or `related_work` often `background`
   — but the sentence decides.
3. **A list citation** (`[1–8]`, "e.g. [3, 5]") with nothing said about each work is
   `background`.
4. **`cites`**: the anchors (1–3) of the contexts that support the verdict, copied from that
   reference's own `contexts`.
5. Classify **every** reference in the input, once, by its `ordinal`.

## Hard rules

1. **Only the given input.** Judge from the contexts, never from what you know about the
   cited work.
2. **Every item cites ≥ 1 anchor** from that reference's own `contexts`, copied verbatim.
   Never construct, guess or shorten an anchor.
3. **Ordinals exactly as given**; no reference invented, none repeated.
4. **When unsure, `background`.** The stronger intents need the words to say so.

## Output

One JSON object: `{"citations": [{"ordinal", "intent", "cites"}]}`.

## Example

Input (excerpt): ordinal 5, context `ch03/s02/p001` (method): "We use the Adam optimizer [5] with β1 = 0.9."; ordinal 9, context `ch02/p003` (method): "Our layer generalises the gated unit of [9] to many heads."; ordinal 14, context `ch05/p004` (results): "We outperform the ConvS2S ensemble [14] by 2 BLEU."

```json
{
  "citations": [
    {"ordinal": 5, "intent": "uses", "cites": ["ch03/s02/p001"]},
    {"ordinal": 9, "intent": "extends", "cites": ["ch02/p003"]},
    {"ordinal": 14, "intent": "compares", "cites": ["ch05/p004"]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
