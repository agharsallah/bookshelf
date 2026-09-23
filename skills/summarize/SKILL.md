---
name: summarize
description: Write the short summary of one chapter (or a whole document) in Bookshelf — what it is about, its thesis and its scope, in 3–5 cited paragraphs of at most 150 words — for library cards, search result headers and "should I reread this?". Use for a chapter_summary / book_summary (pipeline stage 3) or when the user asks for a quick summary of a chapter anchor such as `ch03`. For what to retain, use distil-section or distil-chapter instead.
argument-hint: <document-slug> [chapter-anchor]
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <chapter-anchor>` (for example `okafor-queueing ch03`), or
just `<document-slug>` for a whole-document summary.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/summarize/inputs?document=<slug>&anchor=<anchor>"`
   (omit `&anchor=…` for document scope; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user; count the words before finalising.
3. Write `{"skill": "summarize", "document": "<slug>", "anchor": <inputs.scope.anchor>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/summarize-<slug>-<anchor with / replaced by ->.json` (`summarize-<slug>.json` for a document).
4. Import it; the server runs the same schema, anchor, grounding and word-cap gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, word count).
<!-- interactive:end -->

# Summarize a chapter

## Role

You write the **map**, not the territory. A summary answers *"what is this chapter about?"* —
its topic, its thesis and its scope — so a reader can decide whether to open it. It is not a
distillation: it does not try to capture what the reader must retain. You read the chapter's
blocks (`blocks`, in reading order) and any figure takeaways (`figures`). If `scope.kind` is
`document`, the blocks are the whole work and you summarize the work.

## Method

1. **Find the thesis.** Skim all blocks. What single claim does the chapter exist to make?
   Authors usually state it in the first or last few paragraphs; prefer their statement.
2. **Find the scope.** What ground does it cover (the three or four moves it makes), and, if
   the text says so, what it deliberately leaves to later?
3. **Write 3–5 paragraphs, ≤ 150 words in total** — typically:
   1. what the chapter is about and its thesis;
   2. – 4. the main moves, one per paragraph, one or two sentences each;
   5. (optional) what it sets up or where it stops, if the text says so.
4. **Keep:** topic, thesis, scope, the one concept the chapter introduces by name.
   **Drop:** definitions, mechanisms, numbers, examples, caveats, figure data, quotations —
   those belong to the distillation. A number stays only if it *is* the thesis.
5. **Cite** every span: the block(s) where that claim is actually made — the thesis to the
   block that states it, each move to the block where it is argued. One to three anchors per span.
6. **Count words.** Over 150: cut the optional paragraph first, then compress moves.

## Hard rules

1. **Only the given input.** Summarize what these blocks say. Do not add context about the
   author, the field or other chapters from your own knowledge; never present outside
   knowledge as the book's claim.
2. **Every span cites ≥ 1 anchor that appears verbatim in the input** — a `blocks[].anchor` or
   a `figures[].anchor`. Cite the most specific block (the paragraph, not the section). Never
   construct, guess or shorten an anchor.
3. **Plain statements, no meta-talk.** Write "Utilization above 80 percent makes waiting
   explode", not "This chapter discusses utilization". State the author's claims as claims;
   say "the author argues" only where the text itself hedges or disputes.
4. **Paragraph blocks only**, 3 to 5 of them, each with at most six spans. No headings, bullets,
   callouts or quotes.
5. **Never paraphrase verbatim material into a claim it does not make**; if a formula or table
   is the chapter's centre, name what it relates, do not restate its content.
6. **Thin or garbled input** (a part-title page, a few lines, scrambled OCR): write exactly
   three paragraphs — what the legible blocks say (cited), what the scope's heading and first
   block indicate it covers (cited), and a single span with `"cites": []` reading
   "The extracted text of this scope is too thin or garbled to summarize further." The missing
   citation deliberately routes the summary to review. Never pad with invented content.
7. Write in the language of the source.

## Output

One JSON object: `{"blocks": [3–5 paragraph blocks]}`, at most 150 words across all spans.

## Example

Input (excerpt): `scope` = `{"anchor": "ch03", "kind": "chapter", "heading": "Utilization Is a Trap"}`; `blocks` include
`ch03/s01/p001` "Managers love a fully booked team. This chapter argues that the love is misplaced: past a point, every extra percent of utilization buys a disproportionate amount of waiting.",
`ch03/s01/p004` (Figure 3.1's discussion), `ch03/s02/p003` "Utilization is only half the story; the other half is variability.",
`ch03/s03/p001` "If waiting is the price of busyness, slack is not waste. It is capacity held in reserve for the work you cannot predict."

```json
{
  "blocks": [
    {"type": "paragraph", "spans": [{"text": "Keeping a team fully booked backfires: beyond a certain point, each extra percent of utilization buys a disproportionate amount of waiting.", "cites": ["ch03/s01/p001"]}]},
    {"type": "paragraph", "spans": [{"text": "The chapter first shows how waiting grows slowly and then steeply as a single server gets busier.", "cites": ["ch03/s01/p004", "ch03/s01/f001"]}]},
    {"type": "paragraph", "spans": [{"text": "It then adds variability as the second cause of waiting, alongside utilization.", "cites": ["ch03/s02/p003"]}]},
    {"type": "paragraph", "spans": [{"text": "It closes by recasting slack as reserve capacity for unpredictable work rather than waste.", "cites": ["ch03/s03/p001"]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
