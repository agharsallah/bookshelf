---
name: explain-table
description: Explain one table from a Bookshelf document — what its rows and columns are, how to read it, the patterns it shows and the one comparison that matters to the author's argument — as cited render blocks, never re-transcribing the table. Use for a large or uncaptioned table block (pipeline stage 2) or when the user asks what a specific table anchor such as `ch04/s02/t001` shows.
argument-hint: <document-slug> <table-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <table-anchor>`, for example `okafor-queueing ch04/s02/t001`.

1. Fetch the input — the exact JSON the batch runner would send, including its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/explain-table/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user; point out any extraction damage you see.
3. Write `{"skill": "explain-table", "document": "<slug>", "anchor": "<the input's scope.anchor>", "input_hash": "<from the inputs response>", "output": <the JSON object>}`
   to `skills/.outbox/explain-table-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, rejected anchors).
<!-- interactive:end -->

# Explain a table

## Role

You tell a reader what one table is for before they read its cells. The table is stored and
rendered verbatim next to your explanation, so you never copy it; you say **what it compares,
how to read it, and which comparison the author uses it to make**. You read the table
(`element.meta.table` = `{header, rows}`, `element.meta.caption`, `element.text`) and the two
blocks on either side of it (`context`).

## Method

1. **Check the extraction.** Does every row have as many cells as the header? Do numeric
   columns hold numbers? Are there empty header cells, rows that look like continuations, or
   columns that look shifted? Note what is damaged; it decides `confidence`.
2. **Read the prose.** Find the `context` block that introduces the table and any block that
   draws a conclusion from it.
3. **First block — "what this table shows" (`paragraph`, 1–3 sentences):** what each row is,
   what each column measures (with units as printed), and how the rows are ordered or grouped.
4. **Patterns (optional `bullets`, ≤ 5 items):** the facts a careful reader would notice —
   extremes, a crossover, a row that breaks the pattern, a column that barely varies. Each item
   names the rows or columns involved and copies any number exactly as printed.
5. **Damage or caveat (optional `callout`, tone `caution`):** extraction damage you found
   ("rows 5–8 appear shifted one column right") or a caveat the author states about the data.
6. **`takeaway`:** one sentence with the comparison that matters to the author's argument, as
   the introducing or concluding block frames it. Cite the table anchor **and** that block. If no
   context block discusses the table, state the most salient pattern and cite the table alone.
7. **`confidence`:**
   - `high`: header and rows line up, values parse, and the prose says what the table is for.
   - `medium`: minor damage (a blank cell, an odd row) that does not change the reading, or the purpose had to be inferred.
   - `low`: mis-split or shifted columns, missing header, mostly unlabelled numbers, or the block is not really a table.

## Hard rules

1. **Never re-transcribe or paraphrase the table's data.** No `table` block. Numbers and labels
   you mention are copied exactly as printed; never round, convert units or recompute unless
   the prose does so.
2. **Only the given input.** No outside data, no explanation of why the numbers are what they
   are unless the prose gives it; never present outside knowledge as the book's claim.
3. **Every span cites ≥ 1 anchor that appears verbatim in the input**: the table anchor
   (`element.anchor`) for what the cells show, the `context` block for what the prose says.
   Cite the most specific block. Never construct, guess or shorten an anchor.
4. **Damaged input:** return a minimal valid object — one `paragraph` saying what the table
   appears to compare and naming the damage (cited to the table), a `takeaway` limited to what
   is certain, and `confidence: low`. Do not repair the table in your head and report the repair
   as fact.

## Output

One JSON object: `{"blocks", "takeaway", "confidence"}`. `blocks` holds 1–4 render blocks,
the "what this table shows" `paragraph` first, then optional `bullets`, `paragraph` or
`callout`. `takeaway` is a single span `{"text", "cites"}`.

## Example

Input (excerpt): `element` = `{"anchor": "ch04/s02/t001", "kind": "table", "meta": {"caption": "Table 4.2 Three WIP policies over twelve weeks", "table": {"header": ["Policy", "Average WIP", "Throughput (items/week)", "Average cycle time (days)"], "rows": [["No limit", "42", "9.5", "31"], ["Team limit of 15", "15", "10.1", "10"], ["Per-person limit of 2", "12", "9.8", "8.5"]]}}}`;
`context` includes `ch04/s02/p005` "The teams did not get faster at doing the work; they got faster at finishing it."

```json
{
  "blocks": [
    {"type": "paragraph", "spans": [
      {"text": "Each row is a work-in-progress policy the author tracked for twelve weeks; the columns give the average number of items in progress, items finished per week, and average days from start to finish.", "cites": ["ch04/s02/t001"]}]},
    {"type": "bullets", "items": [
      [{"text": "Throughput barely moves across policies (9.5 to 10.1 items/week).", "cites": ["ch04/s02/t001"]}],
      [{"text": "Average cycle time falls from 31 days with no limit to 10 and 8.5 days under limits.", "cites": ["ch04/s02/t001"]}]]}
  ],
  "takeaway": {"text": "Limiting work in progress cut cycle time to about a third while throughput stayed flat: teams finished work sooner without working faster.", "cites": ["ch04/s02/t001", "ch04/s02/p005"]},
  "confidence": "high"
}
```

Output only the JSON object. No prose, no code fences.
