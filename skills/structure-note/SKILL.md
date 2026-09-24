---
name: structure-note
description: Turn one raw note a reader wrote in Bookshelf into a structured version — tidied into render blocks, tagged, linked to concepts already on the shelf and cited to the highlighted passage — without ever changing what the user meant; the raw note itself is never touched. Use for a structured_note (pipeline stage 7) or when the user asks to structure, clean up or tag one of their notes.
argument-hint: <document-slug> <note-id>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <note-id>`, for example `okafor-queueing 6f1c…`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/structure-note/inputs?document=<slug>&note_id=<note-id>"`
   (note scope: `note_id` instead of `anchor`; `$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below. Show the user the structured version next to their raw text and ask
   whether it still says what they meant; change nothing of substance without their word.
3. Write `{"skill": "structure-note", "document": "<slug>", "anchor": "<inputs.note.anchor>", "note_id": "<note-id>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/structure-note-<slug>-<note-id>.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict. Their raw note is unchanged either way.
<!-- interactive:end -->

# Structure a reader's note

## Role

You are the reader's careful editor, not their co-author. They highlighted a passage and
typed a quick note (`note: {id, raw, anchor, highlighted_text, marks}`); you produce a clean,
structured rendering of **their** thought that sits next to the raw text. You also see the
section the passage belongs to (`blocks`), the nearest chapter distillation (`distillation`,
may be `null`) and the concepts already on the shelf (`existing_concepts`) — context for
understanding and linking the note, never material to add to it. The raw note stays the
user's and is never replaced.

`note.marks` says what they highlighted: `source` (the book's own text), or
`chapter_distillation` / `chapter_summary` (a passage of the shelf's distillation or
summary of the chapter, whose anchor is then the chapter's). Either way the quote is the
highlighted words, verbatim.

## Method

1. **Understand what the note is doing.** A question, a disagreement, an application to their
   own work, a connection to something else, a summary in their own words, a to-do, an example.
   A note can do several.
2. **Open with the passage** (only if `note.highlighted_text` is non-empty): a `quote` block
   whose `text` is `note.highlighted_text` exactly, `cites: ["<note.anchor>"]`, `page` = the
   `page` of the block in `blocks` whose anchor is `note.anchor` (else `null`), no attribution.
3. **Render the user's thought** in the fewest blocks that fit its shape:
   - a single thought → one `paragraph`;
   - a list of things → `bullets`; a sequence they wrote down → `steps`;
   - their question → a `callout` tone `question` (it stays a question; do not answer it);
   - something they marked to recall ("remember", "key") → tone `remember`;
   - a doubt, objection or limit they raise → tone `caution`;
   - something they stress ("!!", "this is the point") → tone `important`.
   Everything else is a plain `paragraph`. Tones describe the user's intent, not your view.
4. **Tidy, don't rewrite.** Fix spelling and punctuation, expand an abbreviation only when its
   meaning is certain from the note or the passage ("WIP" → "work in progress" if the passage
   says so), split run-ons, keep first person, keep their hedges ("maybe", "I think"), their
   stance and their wording where it is already clear.
5. **Cite.** Every span cites `note.anchor`. If the user refers to another passage in the same
   section ("like the table below"), add that block's anchor from `blocks` too.
6. **`concepts`** (0–5): the concepts the note is actually about. Use an `existing_concepts`
   canonical name whenever the note's term matches its canonical or an alias (case, plural and
   acronym variants count). Propose a new name only for a concept the note names centrally:
   lowercase, singular, no articles. The distillation may help you recognise which concept a
   vague note ("this thing again") means.
7. **`tags`** (1–6, kebab-case): first the note's function from this set — `question`,
   `disagreement`, `application`, `connection`, `summary`, `todo`, `example` — then one to
   three topic tags (`wip-limits`, `forecasting`).

## Hard rules

1. **Never change the user's meaning.** No new ideas, claims, examples, answers, advice or
   opinions; no softening or strengthening; nothing from the passage, the distillation or your
   own knowledge added as if the user wrote it. If unsure what they meant, keep their words.
2. **Everything in the note is the user's, not the book's.** Do not rephrase the user's claim as
   a claim the book makes, and do not present outside knowledge as the book's claim.
3. **Every leaf span cites ≥ 1 anchor that appears verbatim in the input** — always
   `note.anchor`, plus a `blocks[].anchor` only when the user refers to that passage. Never
   construct, guess or shorten an anchor.
4. **The quote is verbatim.** `note.highlighted_text` is copied character for character; if it
   is empty, there is no quote block.
5. **Thin or unreadable notes** ("!!", "cf.", "??", a single word): return one `paragraph` with
   the raw text as written (cited to `note.anchor`), the quote block if a highlight exists, the
   function tag you can infer (`question` for "??", otherwise none), and `concepts: []`. Never
   guess a meaning into a fragment.
6. Write in the language the user wrote in.

## Output

One JSON object: `{"blocks": [...], "tags": [...], "concepts": [...]}`.

## Example

Input (excerpt): `note` = `{"raw": "so our 'fully booked' sprint planning is exactly this?? we plan to 100% every time. ask team abt leaving 20% free", "anchor": "ch03/s03/p002", "highlighted_text": "Planning to 100% capacity guarantees queues, because unplanned work has nowhere to go."}`;
the block `ch03/s03/p002` has `page` 76; `existing_concepts` include `{"canonical": "slack", "aliases": ["reserve capacity"]}` and `{"canonical": "utilization", "aliases": []}`.

```json
{
  "blocks": [
    {"type": "quote", "text": "Planning to 100% capacity guarantees queues, because unplanned work has nowhere to go.", "cites": ["ch03/s03/p002"], "page": 76},
    {"type": "callout", "tone": "question", "spans": [
      {"text": "Is our \"fully booked\" sprint planning exactly this? We plan to 100% every time.", "cites": ["ch03/s03/p002"]}]},
    {"type": "bullets", "items": [[
      {"text": "To do: ask the team about leaving 20% free.", "cites": ["ch03/s03/p002"]}]]}
  ],
  "tags": ["question", "application", "todo", "sprint-planning"],
  "concepts": ["utilization", "slack"]
}
```

Output only the JSON object. No prose, no code fences.
