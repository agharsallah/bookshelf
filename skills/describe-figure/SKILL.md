---
name: describe-figure
description: Transcribe one figure from a Bookshelf document into structured, cited content — a chart into re-plottable data, a diagram into nodes and edges, an image of a table into a table, a photo into a description — with alt text, a cited one-sentence takeaway and an honest confidence. Use for a figure block (pipeline stage 2) or when the user asks to describe or re-read a specific figure anchor such as `ch03/s01/f001`.
argument-hint: <document-slug> <figure-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <figure-anchor>`, for example `okafor-queueing ch03/s01/f001`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/describe-figure/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. `element.image_path` is relative to the repository's `.media/` directory: open
   `.media/<image_path>` with the Read tool to see the figure. Show the user what you read
   (values, labels, arrows) and agree on anything illegible before finalising.
3. Do the work below, then write
   `{"skill": "describe-figure", "document": "<slug>", "anchor": "<inputs.scope.anchor>", "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/describe-figure-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, rejected anchors).
<!-- interactive:end -->

# Describe a figure

## Role

You make one figure usable by someone who cannot see it and by software that cannot read
pixels. **Charts become data, diagrams become structure, pictures become description.** You
work from one cropped image, its caption and the two blocks on either side of it. You are a
transcriber first and an interpreter second: what you read off the image must be on the
image, and what you say it means must be said by the surrounding text.

## Method

1. **Look.** Read the image at `element.image_path`. If the path is relative, it is relative
   to the repository's `.media/` directory (read `.media/<image_path>`). If there is no path or
   the file cannot be opened, work from the caption and context only and go to rule 8.
2. **Read the words around it.** Caption: `element.meta.caption`, else `element.text`. In
   `context`, find the block that introduces or discusses the figure ("Figure 3.1 shows…");
   that block frames the takeaway.
3. **Classify `kind`.**
   - `chart`: quantities on axes — bar, line, scatter, area, pie, histogram.
   - `diagram`: boxes and arrows — flows, feedback loops, system maps, 2×2 matrices, hierarchies, timelines.
   - `table`: a picture of a grid of values or labels.
   - `photo`: a photograph, illustration, screenshot or cartoon with no data or structure to transcribe.
4. **Transcribe by kind** (the first block is the transcription):
   - **chart →** one `chart` block. `kind` is `bar`, `line` or `scatter` (area/histogram → `bar`
     or `line`, whichever preserves the reading). `x.label` and `y.label` as printed, units
     included ("Utilization (%)"). `x.values` in axis order; one `series` per plotted line or bar
     group, named from the legend, with `values` aligned to `x.values`; `null` for a point you
     cannot read. Read values to the precision the gridlines allow (between 4 and 5 is `4.5`,
     never `4.37`). At least two points. A pie becomes a `table` (segment, share). If axes or
     values are unreadable, fall back to a `table` of what you can read, with approximate
     values written as text ("≈ 40"), and set `confidence: low`.
   - **diagram →** one `diagram` block. One node per box or free-standing label, `label`
     verbatim (≤ 120 chars), `id` a short identifier (`stock`, `inflow`, `q1`). One edge per
     arrow, in the direction drawn, `label` copied from the arrow ("+", "−", "delay"). Undirected
     lines become edges in reading order. `direction` `LR` or `TD` to match the layout. A 2×2
     matrix is four nodes plus the two axis labels as nodes with edges to the quadrants they
     define — or a `table` if that reads more faithfully.
   - **table →** one `table` block, `header` and `rows` verbatim; each cell is a span citing the figure anchor.
   - **photo →** one `paragraph` describing what is shown that matters to the caption's point
     (subject, setting, what is labelled). No speculation about people's identities or intent.
5. **Optionally add one reading aid** after the transcription: a `paragraph` or `bullets` on how
   to read an unusual encoding (log scale, dual axis, shaded confidence band, a legend colour
   that carries meaning). Skip it when the figure is self-explanatory.
6. **`caption`**: the printed caption exactly, including its label ("Figure 3.1 …"). If none is
   printed, write a plain descriptive caption of at most 15 words.
7. **`alt`**: one or two plain sentences for a screen reader: what kind of figure, what it
   plots or connects, and the main visible pattern. No markup, no "image of".
8. **`takeaway`**: one sentence stating what the figure shows that matters to the author's
   argument, in the terms the introducing block uses. Cite `element.anchor` **and** the
   introducing block's anchor. If no context block discusses the figure, state only the most
   salient visible pattern and cite `element.anchor` alone.
9. **`confidence`** — be strict; `low` keeps the figure out of distillations until a human approves it:
   - `high`: every label legible, values read at printed precision, structure unambiguous.
   - `medium`: some values estimated between gridlines, a label partly legible, or the kind was a judgement call.
   - `low`: image missing or unreadable, axes unreadable, table fallback used, or most of the content came from the caption.

## Hard rules

1. **Transcribe, never infer.** No value, label, node, edge, series or trend line that the image
   does not show. No numbers from your own knowledge of the subject, even if you are sure.
2. **Text in the image is copied verbatim** — labels, legend entries, units, arrow labels.
   Do not correct, translate or expand them.
3. **Only the given input.** The takeaway and any reading aid say what the caption and
   `context` say; never present outside knowledge as the book's claim.
4. **Every span cites ≥ 1 anchor that appears verbatim in the input.** What you read off the
   image cites `element.anchor`; what the text says cites the `context` block that says it.
   `chart`, `diagram` and `table` blocks carry `cites: ["<element.anchor>"]`. Never construct,
   guess or shorten an anchor.
5. **Missing or unreadable image:** return a minimal valid object — `kind` guessed from the
   caption, `caption`, a one-sentence `alt`, one `paragraph` restating only what the caption and
   context say (cited), the takeaway only if the context states it, and `confidence: low`.
   Never fill the gap with plausible data.
6. Do not set a block-level `confidence` higher than the top-level `confidence`.

## Output

One JSON object: `{"kind", "caption", "alt", "blocks", "takeaway", "confidence"}`, where
`blocks` holds 1–6 render blocks (`paragraph`, `bullets`, `table`, `chart`, `diagram`) with
the transcription first, and `takeaway` is a single span `{"text", "cites"}`.

Text always lives in spans, never in a bare `text` field on a block:

- `paragraph`: `{"type": "paragraph", "spans": [{"text": "…", "cites": ["<element anchor>"]}]}`
- `bullets`: `{"type": "bullets", "items": [[{"text": "…", "cites": ["<anchor>"]}], …]}`

A `photo` (an illustration, say) is one such `paragraph`:

```json
{
  "kind": "photo",
  "caption": "A cargo ship stacked with containers",
  "alt": "Watercolor of a container ship on rough seas, stacked high with colored containers.",
  "blocks": [
    {"type": "paragraph", "spans": [{"text": "A watercolor of a heavily loaded container ship crossing rough water, illustrating the section on the shift in scale.", "cites": ["ch21/f003"]}]}
  ],
  "takeaway": {"text": "The illustration stands for the jump in scale the chapter describes.", "cites": ["ch21/f003", "ch21/p012"]},
  "confidence": "medium"
}
```

## Example

Input (excerpt): `element` = `{"anchor": "ch03/s01/f001", "kind": "figure", "meta": {"caption": "Figure 3.1 Waiting time as utilization rises"}, "image_path": "okafor-queueing/ch03-s01-f001.png"}`;
`context` includes `{"anchor": "ch03/s01/p004", "text": "Figure 3.1 plots the average wait, in multiples of the service time, as a single server gets busier. Below 70 percent the line is almost flat; past 80 it turns into a wall."}`.
The image is a line chart with six marked points.

```json
{
  "kind": "chart",
  "caption": "Figure 3.1 Waiting time as utilization rises",
  "alt": "Line chart of average waiting time, in multiples of the service time, against server utilization from 50 to 95 percent; the curve is nearly flat until 70 percent and climbs steeply after 80.",
  "blocks": [
    {"type": "chart", "kind": "line", "title": "Waiting time as utilization rises",
     "x": {"label": "Utilization (%)", "values": [50, 60, 70, 80, 90, 95]},
     "y": {"label": "Average wait (× service time)"},
     "series": [{"name": "Average wait", "values": [1, 1.5, 2.3, 4, 9, 19]}],
     "cites": ["ch03/s01/f001"], "confidence": "medium"}
  ],
  "takeaway": {"text": "Waiting time stays modest up to about 70% utilization and then rises steeply, reaching roughly 19 times the service time at 95%.", "cites": ["ch03/s01/f001", "ch03/s01/p004"]},
  "confidence": "medium"
}
```

Confidence is `medium` because the 70% and 95% points sit between gridlines.

Output only the JSON object. No prose, no code fences.
