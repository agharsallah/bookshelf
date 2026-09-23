---
name: parse-outline
description: Propose the chapter and section outline of a Bookshelf document — titles and PDF page ranges — from its printed table of contents and the first lines of its first pages, reconciling printed page numbers with PDF pages. Use when a document's outline was guessed or is wrong (status needs_review) and the user wants to fix chapter boundaries, e.g. `/parse-outline okafor-queueing`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `okafor-queueing`. This skill has no batch
job; it exists for the human outline fix.

1. Fetch the input — the response's `inputs` is the exact JSON a runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/parse-outline/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below. Show the user the proposed outline as a table (chapter, pages, sections)
   and the page offset you derived; ask about anything ambiguous (parts, appendices,
   unnumbered introductions) and revise until they agree.
3. Write `{"skill": "parse-outline", "document": "<slug>", "anchor": <inputs.scope.anchor>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/parse-outline-<slug>.json`.
4. Import it; the server validates it against the schema and stores the outline override:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the result; a re-parse applies the override.
<!-- interactive:end -->

# Propose a document outline

## Role

You recover the chapter structure of a book from its front matter so the parser can cut it
into chapters and sections correctly. You see the printed table of contents (`toc_text`, may
be empty) and the first ~25 lines of each of the first 30 pages (`pages: [{page, lines}]`),
plus the document's page span in `scope.page_from`/`scope.page_to`. Page numbers you output
are **PDF pages as numbered in `pages[].page`**, not the numbers printed in the book.

## Method

1. **Parse the table of contents.** From `toc_text` (or, if empty, from contents pages you
   find in `pages`), list entries with their printed page numbers. Decide each entry's level:
   - chapter: "Chapter N", a bare number ("3 Utilization is a trap"), or top-level indentation;
   - section: dotted numbers ("3.2"), deeper indentation, or unnumbered entries under a chapter;
   - part: "Part I", "Book Two" — a grouping, **not** a chapter; its chapters become top-level.
2. **Find the page offset** (`pdf page − printed page`). Locate at least one chapter's opening
   in `pages`: a page whose first lines carry the chapter number and title. Two chapters that
   agree make the offset certain; if front matter uses roman numerals, the offset jumps where
   arabic page 1 begins. If no chapter opening is visible, use the page whose lines show printed
   page "1" or the first body text.
3. **Map every entry** to PDF pages with that offset.
4. **Decide what counts as a chapter.** Keep: introduction or prologue that carries content,
   numbered chapters, conclusion/epilogue, appendices that carry content. Drop: cover, title,
   copyright, dedication, contents, list of figures, acknowledgments, notes, bibliography,
   index, about the author.
5. **Page ranges.** `page_to` of a chapter is the next chapter's `page_from − 1`. The last
   kept chapter ends one page before the first dropped back-matter entry (notes, bibliography,
   index) if the TOC lists one, otherwise at `scope.page_to`.
6. **Titles** are the printed titles without their label ("Chapter 3:", "3", "3.2"), keeping
   the book's wording and punctuation; convert ALL-CAPS headings to title case.
7. **Sections** are the chapter's second-level TOC entries with their start pages; `[]` when
   the TOC has none. Do not invent sections from running heads.
8. **No table of contents at all:** infer chapters only from chapter openings visible in
   `pages` (pages 1–30 only). Return those you can see, with the last visible chapter's
   `page_to` at the page before the next visible opening or at `scope.page_to`; the human fix
   will extend it.
9. **Sanity check:** chapters in order, non-overlapping, `page_from ≤ page_to`, every page within
   `scope.page_from`–`scope.page_to`, sections inside their chapter's range.

## Hard rules

1. **Only the given input.** Never fill in chapters from your own knowledge of the book, even
   if you recognise it.
2. **Never invent entries or pages.** An entry without a printed page number is placed only if
   its opening page is visible in `pages`; otherwise leave it out.
3. **Copy titles faithfully** — no rewording, no subtitles added or dropped.
4. **Thin or garbled input** (no TOC and no recognisable chapter openings, or scrambled OCR):
   return `{"chapters": []}`. An empty outline sends the document to a human; a wrong one
   silently mis-cuts every chapter.
5. The output has no citations; do not add any other keys.

## Output

One JSON object: `{"chapters": [{"title", "page_from", "page_to", "sections": [{"title", "page_from"}]}]}`
in reading order.

## Example

Input (excerpt): `scope` = `{"kind": "document", "page_from": 1, "page_to": 268}`;
`toc_text` = "Contents\nIntroduction ix\n1 Why Work Waits 1\n2 Little's Law 17\n2.1 The law 18\n2.2 Forecasting with it 24\n2.3 Where it breaks 29\n3 Utilization Is a Trap 35\n…\n7 Managing by Flow 201\nNotes 229\nIndex 241";
`pages` shows `{"page": 9, "lines": ["INTRODUCTION", …]}` and `{"page": 17, "lines": ["1", "WHY WORK WAITS", …]}`, so printed page 1 is PDF page 17 (offset +16) and printed ix is PDF page 9.

```json
{
  "chapters": [
    {"title": "Introduction", "page_from": 9, "page_to": 16, "sections": []},
    {"title": "Why Work Waits", "page_from": 17, "page_to": 32, "sections": []},
    {"title": "Little's Law", "page_from": 33, "page_to": 50, "sections": [
      {"title": "The law", "page_from": 34}, {"title": "Forecasting with it", "page_from": 40}, {"title": "Where it breaks", "page_from": 45}]},
    {"title": "Managing by Flow", "page_from": 217, "page_to": 244, "sections": []}
  ]
}
```

(Chapters 3–6 elided here; a real output lists every chapter.)

Output only the JSON object. No prose, no code fences.
