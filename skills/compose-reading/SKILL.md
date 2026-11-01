---
name: compose-reading
description: Weave a Bookshelf document's approved distillations, summaries and notes into one linked reading edition — a through-line, a short bridge per chapter that says what it adds and which parts it leans on, and a closing map of the ideas that return. The composed reading PDF prints each bridge just before that chapter's approved notes. Use when the user wants the generated notes to read as one document, e.g. `/compose-reading okafor-queueing`.
argument-hint: <document-slug>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>`, for example `okafor-queueing`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/compose-reading/inputs?document=<slug>"`
   (document scope: no `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user: agree on the through-line and on what each chapter adds before writing the connections.
3. Write `{"skill": "compose-reading", "document": "<slug>", "anchor": <inputs.scope.anchor>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/compose-reading-<slug>.json`.
4. Import it; the server runs the same schema, anchor, grounding and length gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, word count).
<!-- interactive:end -->

# Compose the reading edition

## Role

You write the spine of the composed reading PDF. That PDF already prints every approved note — the summary, the distillation and the section notes of each chapter, then the brief, guide, glossary and quotes as reference. What it lacks without you is **one voice, one order, and explicit links**. You supply them:

| Your part | Where it prints | What it must do |
| --- | --- | --- |
| `preface` | Introduction, first page | Tell the reader how the edition is arranged and how to use it. |
| `through-line` | Introduction | The whole argument in a few paragraphs: claim, mechanism, what follows. Replaces the brief at the front. |
| one part per chapter | Opens that chapter, in a "Where this sits" box **directly above its approved notes** | A bridge: what this chapter adds, and which earlier part it builds on or changes. Its `title` becomes the chapter's title in the contents. |
| `connections` | After the last chapter | The ideas that recur, and the chapters each one returns in. |

Because the notes print right after your chapter part, **never restate the distillation**: the reader is about to read it. Say what to look for in it and how it ties to the rest.

Your input is `chapters` (each distilled chapter: `anchor`, `heading`, `distillation`, optional `summary`, `notes`), and whatever of `brief`, `guide`, `glossary`, `quotes` and `paper_card` the shelf has approved. A paper's units arrive as `chapters` the same way a book's do. You do not see the source text. Everything you write is drawn from these notes, and every span cites source anchors those notes already cite.

## Method

1. **Read the chapters in order**, then the brief or paper card and the guide. If the guide has a `journey`, use each chapter's `role` and `takeaway` as a starting point — not as text to copy. Write down the claim the book keeps returning to, and for each chapter one sentence: what it adds that the previous chapters did not.
2. **Write `title`**: one line naming the through-line, not the book's title.
3. **Write `preface`**: one or two short paragraphs — the arrangement (through-line, then each chapter as bridge + notes, then connections) and the one question to keep in mind while reading. Cite the passage the question rests on.
4. **Write `parts`, in this order:**
   1. `id` `"through-line"`. Two to five blocks. `see` names the chapter parts a reader should open first.
   2. **One part per item of `chapters`, in that order.** `id` is that chapter's `anchor`. The `title` names the chapter's idea in a few words (it prints under the chapter's real heading, so do not repeat the heading). One to three blocks, about 60–180 words: first what this chapter adds, then how it depends on or changes an earlier part — name that part in the prose. A `callout` (`insight`) for the one thing to watch for in the notes below works well. `see` names `through-line` or the parts it leans on.
   3. `id` `"connections"`. One block per recurring idea (a `definition` with the idea as `term`, or a bullet), each saying which chapters return to it. `see` names those chapter parts.
5. **Point with `see`, cite with `cites`.** `see` holds part ids (`through-line`, a chapter anchor, `connections`). `cites` holds source anchors from the input (`ch03/s02/p014`). A part id is never a citation, and a source anchor is never a `see` target — even when a chapter anchor looks like both.
6. **Use the glossary and the quotes when they sharpen a part** — a `definition` block for a term the through-line depends on, one `quote` block where the author says it best — and skip them when they only repeat your prose.
7. **Self-check before output:**
   - part ids are `through-line`, then every chapter anchor in input order, then `connections`;
   - the through-line's `see` names at least one chapter; `connections`' `see` names every chapter it mentions (at least two when the book has two or more);
   - no part names itself in `see`;
   - every span is cited, and every chapter anchor appears in some cite;
   - no chapter part re-explains what its own distillation already says.

## Hard rules

1. **Only the given input.** No outside facts, no "later research", no chapter the input did not offer. A paper card's limits are the paper's limits, phrased as the card phrases them.
2. **Link the parts.** A chapter part that could be read with no idea where it sits in the book is a failed part: name the dependency in the prose and in `see`.
3. **Collapse repeats.** When the brief and a chapter say the same thing, say it once, in the through-line, and let the chapter part say only what it adds.
4. **Stay short.** The notes carry the detail; the edition carries the thread. A chapter part is a bridge, the whole edition well under 8,000 words.
5. **Write in the language of the notes.**

## Output

One JSON object: `{"title", "preface": [paragraph|callout], "parts": [{id, title, see, blocks}]}`. `parts` starts with `through-line`, then one part per chapter, and ends with `connections`.

## Example

Input (excerpt): `chapters` is one item, `anchor` `ch01`, heading "The bathtub", distillation citing `ch01/p001` that a stock changes only when inflow and outflow differ.

```json
{
  "title": "Stocks remember, flows change them",
  "preface": [
    {"type": "paragraph", "spans": [{"text": "Read the through-line first; each chapter then opens with where it sits before its notes, and the connections close the loop.", "cites": ["ch01/p001"]}]}
  ],
  "parts": [
    {"id": "through-line", "title": "Watch the stock, not the event", "see": ["ch01"], "blocks": [{"type": "paragraph", "spans": [{"text": "A stock is the memory its flows write, so watch it before the events that fill it.", "cites": ["ch01/p001"]}]}]},
    {"id": "ch01", "title": "The level moves only by the difference", "see": ["through-line"], "blocks": [{"type": "paragraph", "spans": [{"text": "This is where the through-line's stock first appears: the level changes only as fast as inflow and outflow differ.", "cites": ["ch01/p001"]}]}]},
    {"id": "connections", "title": "Where the book returns", "see": ["ch01"], "blocks": [{"type": "definition", "term": "Stock", "spans": [{"text": "Every later loop is this same stock with the flows tied back to it.", "cites": ["ch01/p001"]}]}]}
  ]
}
```

Output only the JSON object. No prose, no code fences.
