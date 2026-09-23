---
name: extract-quotes
description: Pick the most citable passages of one chapter of a Bookshelf document as verbatim quote blocks with page numbers and attribution — thesis sentences, sharp definitions, memorable formulations — copied character for character from the source blocks. Use for a quote_set (pipeline stage 10, derive) or when the user asks for quotable lines from a chapter anchor such as `ch03`.
argument-hint: <document-slug> <chapter-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <chapter-anchor>`, for example `okafor-queueing ch03`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/extract-quotes/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; show the user your shortlist and let them add or drop quotes.
3. Write `{"skill": "extract-quotes", "document": "<slug>", "anchor": "<inputs.scope.anchor>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/extract-quotes-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, rejected anchors).
<!-- interactive:end -->

# Extract quotes from a chapter

## Role

You pick the lines from one chapter that a reader would want to quote in their own writing,
and you copy them **exactly**. A quote set is citable verbatim material: if a single character
differs from the book, it is worthless. You read the chapter's source blocks (`blocks`, in
reading order, each with `anchor`, `kind`, `text`, `page`); `figures` are not quotable.

## Method

1. **Scan for candidates:**
   - the author's thesis sentences and the chapter's central claim in the author's words;
   - sharp definitions ("Stable has a precise meaning here: …");
   - memorable formulations and coined phrases;
   - strong, self-contained claims a reader might want to argue with;
   - quotations of other people the author includes (`quote` blocks or quoted speech in a paragraph).
2. **Reject** sentences that need surrounding context to make sense ("This is why it fails."),
   transitions, list fragments, example details, numbers without their claim, and anything in
   a table, code listing or formula.
3. **Cut each quote to 1–4 whole sentences (≤ 60 words)** from **one** block: a contiguous
   substring of that block's `text`, starting and ending at sentence boundaries.
4. **Fill the block:** `text` = the substring exactly; `cites` = `[that block's anchor]`;
   `page` = that block's `page` (may be `null`); `attribution` = the author(s) from
   `document.authors` joined with " and " for the author's own words, or
   the speaker as the text identifies them plus "quoted by" / "interviewed by" the author
   when the words are someone else's ("W. Edwards Deming, quoted by Ines Okafor").
5. **Choose 5–12 quotes** (fewer for a short chapter), no two making the same point, in reading order.

## Hard rules

1. **Verbatim, character for character.** Copy `text` exactly as it appears in the block —
   same words, spelling, capitalisation, punctuation and typographic quotes. No ellipses, no
   brackets, no merging across blocks, no corrections (not even of typos). If extraction damage
   (a broken hyphenation, stray characters) sits inside a candidate, skip that candidate.
2. **Only the given input.** Never supply a famous line from memory, even if you know the book;
   never attribute words to anyone the text does not identify as their speaker.
3. **Every quote cites exactly one anchor** — the block it was copied from, as it appears in
   `blocks[].anchor`. Never construct, guess or shorten an anchor.
4. **`page` comes from the cited block**; never compute or guess it.
5. **Thin or garbled input** (no whole, legible, self-contained sentences): return
   `{"blocks": []}`. Never pad.

## Output

One JSON object: `{"blocks": [quote blocks]}` — each `{"type": "quote", "text", "cites": [one anchor], "page", "attribution"}`.

## Example

Input (excerpt): `document.authors` = `["Ines Okafor"]`; `blocks` include
`{"anchor": "ch03/s01/p001", "page": 51, "text": "Managers love a fully booked team. This chapter argues that the love is misplaced: past a point, every extra percent of utilization buys a disproportionate amount of waiting."}`,
`{"anchor": "ch03/s03/p001", "page": 73, "text": "If waiting is the price of busyness, slack is not waste. It is capacity held in reserve for the work you cannot predict."}`,
`{"anchor": "ch03/s03/q001", "kind": "quote", "page": 74, "text": "\"Nobody ever got a promotion for the fire that didn't start.\" — a plant manager the author interviewed"}`.

```json
{
  "blocks": [
    {"type": "quote", "text": "This chapter argues that the love is misplaced: past a point, every extra percent of utilization buys a disproportionate amount of waiting.", "cites": ["ch03/s01/p001"], "page": 51, "attribution": "Ines Okafor"},
    {"type": "quote", "text": "If waiting is the price of busyness, slack is not waste. It is capacity held in reserve for the work you cannot predict.", "cites": ["ch03/s03/p001"], "page": 73, "attribution": "Ines Okafor"},
    {"type": "quote", "text": "Nobody ever got a promotion for the fire that didn't start.", "cites": ["ch03/s03/q001"], "page": 74, "attribution": "A plant manager interviewed by Ines Okafor"}
  ]
}
```

"Managers love a fully booked team." was rejected: it only sets up the claim that follows.

Output only the JSON object. No prose, no code fences.
