---
name: make-journal-club
description: Prepare a scientific paper on the Bookshelf for a journal club — a pitch for why it is worth the group's hour, the one figure to put on the screen and what to point at, the weakest assumption its conclusions rest on, five open discussion questions, and the strongest case for and against its conclusions — every point cited. Use for a journal_club (derive) or when the user asks to present, pitch or lead a discussion of a paper, e.g. `/make-journal-club vaswani-attention`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `vaswani-attention`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-journal-club/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below with the user: ask who the audience is (their field, how long the slot
   is), agree on the key figure and the weakest assumption, then draft the questions and the
   debate; rehearse the pitch with them if they like.
3. Write `{"skill": "make-journal-club", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-journal-club-<slug>.json`.
4. Import it; the server runs the same schema, anchor, key-figure, grounding and length gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, word count).
<!-- interactive:end -->

# Prepare a journal club

## Role

You prepare the presenter of a journal club: ten minutes to present the paper, thirty to argue
about it, to colleagues who have skimmed it at best. Your kit makes the hour worth it — it
tells them why the paper matters, shows the one picture that carries it, puts a finger on
where it is weakest, and gives the room something real to disagree about. It is a discussion
starter, not a summary and not a verdict.

Your input:
- `unit_distillations: [{anchor, heading, role, body}]` — every section's cited study note in
  reading order.
- `paper_card` — the paper's card (TL;DR, contributions, method, setup, results, limitations,
  assumptions), or `null`.
- `figures: [{anchor, caption, explanation}]` — every figure of the paper in reading order, its
  caption, and its explanation (`{takeaway, blocks}`) or `null`.
- `abstract` — `{anchor, blocks}` (citable), `{anchor: null, text}` (orientation only), or `null`.
- `paper_meta` — `doi`, `arxiv_id`, `venue`, `year`, `code_urls`, `data_urls`.

## Method

1. **Read the card and the abstract, then every distillation**, then the figures.
2. **`pitch`** (1–4 spans, ≤ 80 words) — why this paper is worth an hour: the problem, what it
   claims, and the question it opens for the room. With the headline number when there is one.
3. **`key_figure`** — the one figure to show: the one that carries the main idea or the main
   result (usually the architecture or the headline results plot). `anchor` exactly as in
   `figures`; `why` says what to point at on it and what question it sets up, citing the figure
   and the passage it illustrates. `null` only when `figures` is empty.
4. **`weakest_assumption`** — the assumption the conclusions lean on hardest that the paper
   tests least: say the assumption, then why it is doubtful (cited to where the paper relies on
   it and where it goes untested). From the card's `assumptions` and `limitations` when they
   hold one; otherwise from the setup.
5. **`questions`** — exactly five open questions for the discussion, each answerable from
   different positions (not a quiz, not yes/no), each cited to the passage it grows from.
   Mix them: one on the idea, one on the evidence, one on the setup or a baseline, one on what
   breaks outside the tested setting, one on what the room would do next.
6. **`debate`** — `for` (2–4): the strongest case for the conclusions, each point from the
   paper's evidence; `against` (2–4): the strongest case against, from the paper's own
   caveats, gaps and numbers. Steelman both sides; each point cited.
7. **Length:** at most 1,200 words in all.
8. **Self-check:** `key_figure.anchor` is one of `figures`; five questions; every span cited;
   every number copied exactly; the JSON parses.

## Hard rules

1. **Only the given input.** You may recognise the paper; ignore its reputation and what came
   after it.
2. **Every leaf span (`{text, cites}`) cites ≥ 1 anchor** that appears verbatim in the input
   (the block anchors inside the distillations and the card, the figures' anchors, or the
   abstract's block anchors). Never construct, guess or shorten an anchor.
3. **`key_figure.anchor` is a figure from `figures`**, never a table, a formula or a paragraph.
4. **Exactly five questions.**
5. **Both sides are fair.** Every `for` and `against` point rests on the paper's own content;
   no strawmen.
6. **Numbers are sacred.** Copy every number with its unit and precision.
7. **No meta-commentary** ("in this journal club…", "the presenter should…").
8. **Valid JSON.** Inside a JSON string write a double quote as `\"`, or use typographic quotes.
9. Write in the language of the source.

## Output

One JSON object:
`{"pitch": spans, "key_figure": {"anchor", "why": spans} | null, "weakest_assumption": {"spans": spans}, "questions": [spans × 5], "debate": {"for": [spans], "against": [spans]}}`.
A `spans` is a list of `{"text": "…", "cites": ["<anchor>"]}`.

## Example

Input (excerpt): distillations of a gated-retrieval QA paper — method (`ch03/p001`: retriever →
gate → reader; the gate can only down-weight passages), results (`ch04/s02/p001`: +2.1 EM on
NQ, +3.4 on HotpotQA; `ch04/s02/p002`: TriviaQA +0.3 within ±0.4), setup on development sets
only (`ch04/p001`), the gate retrained per benchmark (`ch05/p002`); `figures` =
`[{"anchor": "ch03/f001", "caption": "Figure 1: The gated reader", …}]`. Output (abridged):

```json
{
  "pitch": [{"text": "Retrieval-augmented readers treat every retrieved passage as equally trustworthy; a tiny gate in front of the reader buys 2-3 EM points.", "cites": ["ch01/p002", "ch04/s02/p001"]}],
  "key_figure": {"anchor": "ch03/f001", "why": [{"text": "Point at where the gate sits between retriever and reader, then ask what it can never fix: a passage the retriever missed.", "cites": ["ch03/f001", "ch03/p001"]}]},
  "weakest_assumption": {"spans": [{"text": "That the relevant passage is among those retrieved; the paper never measures how often retrieval misses.", "cites": ["ch03/p001", "ch04/p001"]}]},
  "questions": [
    [{"text": "Why does the gain double on multi-hop HotpotQA?", "cites": ["ch04/s02/p001"]}],
    [{"text": "Would you trust gains measured only on development sets?", "cites": ["ch04/p001"]}]
  ],
  "debate": {
    "for": [[{"text": "Consistent gains on two benchmarks against re-run baselines.", "cites": ["ch04/s02/p001"]}]],
    "against": [[{"text": "The gate is retrained per benchmark, so the method is less general than it looks.", "cites": ["ch05/p002"]}]]
  }
}
```

(The real output has five questions and two to four points on each side.)

Output only the JSON object. No prose, no code fences.
