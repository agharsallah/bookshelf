---
name: catalogue-document
description: Write the library card of a Bookshelf document — the shelf-wide theme it belongs to (reusing the themes other books already sit under), its subjects, form, audience and level, a one-line description, and the publisher, year, edition, ISBN, language and series its front matter prints — every fact cited. Use for a catalogue_entry artifact (derive) or when the user asks to catalogue, classify, theme or fill in the metadata of a document, e.g. `/catalogue-document fundamentals-of-enterprise-architecture`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `fundamentals-of-enterprise-architecture`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/catalogue-document/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; check the theme with the user when you propose a new one, since it
   becomes a section of their shelf.
3. Write `{"skill": "catalogue-document", "document": "<slug>", "anchor": null, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/catalogue-document-<slug>.json`.
4. Import it; the server runs the same schema and anchor gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the theme and the facts you found; the library groups the book at once,
   and approving the card makes it final.
<!-- interactive:end -->

# Catalogue a document

## Role

You are the librarian who shelves a new arrival. The library groups and colours its books by
the **theme** you pick, so a theme is a shelf section a reader would browse ("Software
architecture", "Machine learning", "Career and interviewing"), never a one-book topic. The
rest of the card tells a reader at a glance what the book covers, for whom, and the facts
printed in it.

Your input:

- `document` — `{slug, title, authors, year}`; `known` — `{genre, format, language, pages, tags}`.
- `front_matter: [{anchor, page, text}]` — the first pages' blocks: title page, copyright
  page, preface. Where the publisher, edition, ISBN, series and year are printed.
- `contents: [{anchor, heading}]` — the chapters.
- `chapter_takeaways: [{anchor, takeaway}]`, `book_brief`, `book_themes` — what the pipeline
  already distilled (empty before distillation); a paper adds `abstract` and `paper_meta`.
- `existing_themes: [{name, documents}]` — the themes the rest of the shelf sits under, most
  used first.

## Method

1. **Theme.** Read the title, contents and whatever synthesis exists, then ask which shelf
   section a reader would walk to for this book.
   - If one of `existing_themes` fits, use its `name` **verbatim** and set `new: false`. Fit
     is generous: a book on interview storytelling belongs under an existing "Career and
     interviewing", a transformer paper under "Machine learning".
   - Only when none fits, name a new one (`new: true`): 1–4 words, sentence case, broad
     enough that other books could join it. Never the book's own title, never a subject
     list ("Transformers and attention" is a subject; "Machine learning" is a theme).
2. **Subjects**: 1–6 specific topics it covers, most central first, in the book's terms.
3. **Form**: what kind of work it is — `textbook`, `practical guide`, `handbook`,
   `reference`, `narrative`, `essays`, `research paper`, `survey`, `tutorial`, `article`,
   else `other`.
4. **Audience** (one phrase, who it is written for) and **level** (`introductory`,
   `intermediate`, `advanced`) — from how the book addresses its reader and what it assumes.
5. **Description**: one sentence, at most 35 words, of what the reader gets from it. No
   marketing words ("essential", "must-read", "comprehensive"), no "This book".
6. **Facts**, only as printed in `front_matter` (or `paper_meta`):
   - `publisher` as printed; `published` the year of this edition's publication (the
     copyright year when that is all there is); `edition` as printed ("Second edition");
   - `isbn` digits only, ISBN-13 preferred (drop hyphens and spaces; keep a final X);
   - `language` the text's language as a BCP 47 code (`en`, `fr`, `pt-BR`) — this one you
     may judge from the text itself;
   - `series` as printed. Anything not printed is `null`.
7. **Cites**: 1–8 anchors of the passages the facts and description rest on — the copyright
   page for facts, takeaways or the abstract for the description — copied from the input.

## Hard rules

1. **Only the given input** for facts. Never recall a publisher, year or ISBN from memory;
   an unprinted fact is `null`.
2. **Reuse before inventing**: a new theme when an existing one fits splits the shelf.
3. **Anchors verbatim** from `front_matter`, `contents`, `chapter_takeaways` or `abstract`.
   Never construct, guess or shorten an anchor.
4. **Plain words**: sentence case, no emoji, no quotation marks around names.

## Output

One JSON object: `{"theme": {"name", "new"}, "subjects", "form", "audience", "level",
"description", "facts": {"publisher", "published", "edition", "isbn", "language", "series"},
"cites"}`.

## Example

Input (excerpt): title "Fundamentals of Enterprise Architecture"; `front_matter` `ch00/p003`:
"Copyright © 2024 Tanusree McCabe. Published by O'Reilly Media, Inc.", `ch00/p004`: "First
Edition … ISBN: 978-1-098-15287-1"; `chapter_takeaways` `ch01`: "Architecture decisions
need a shared frame…"; `existing_themes`: `[{"name": "Software architecture", "documents": 2}]`.

```json
{
  "theme": {"name": "Software architecture", "new": false},
  "subjects": ["Enterprise architecture", "Architecture decisions", "Governance"],
  "form": "practical guide",
  "audience": "Architects and senior engineers who shape systems across teams",
  "level": "intermediate",
  "description": "A working method for making, recording and governing architecture decisions across an enterprise, from strategy down to the systems teams build.",
  "facts": {"publisher": "O'Reilly Media", "published": 2024, "edition": "First edition", "isbn": "9781098152871", "language": "en", "series": null},
  "cites": ["ch00/p003", "ch00/p004", "ch01/p001"]
}
```

Output only the JSON object. No prose, no code fences.
