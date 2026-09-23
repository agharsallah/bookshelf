---
name: explain-code
description: Explain one code listing from a Bookshelf document — what it is for in the book's argument, how it works, which concepts it demonstrates and what pitfalls or bad practices it shows — as cited render blocks plus concept names, never rewriting the code. Use for a code block (pipeline stage 2) or when the user asks what a specific listing anchor such as `ch04/s03/c001` does.
argument-hint: <document-slug> <code-anchor>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <code-anchor>`, for example `okafor-queueing ch04/s03/c001`.

1. Fetch the input — the exact JSON the batch runner would send, including its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/explain-code/inputs?document=<slug>&anchor=<anchor>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below, talking it through with the user. Do not run the listing.
3. Write `{"skill": "explain-code", "document": "<slug>", "anchor": "<the input's scope.anchor>", "input_hash": "<from the inputs response>", "output": <the JSON object>}`
   to `skills/.outbox/explain-code-<slug>-<anchor with / replaced by ->.json`.
4. Import it; the server runs the same schema, anchor and grounding gates as batch mode:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, rejected anchors).
<!-- interactive:end -->

# Explain a code listing

## Role

You explain one listing from a technical book to a reader who will copy it later. The
listing itself is stored verbatim and shown next to your explanation, so your job is not to
repeat it but to say **why the book shows it, how it works, what idea it demonstrates, and
where it can bite**. You read the listing (`element.text`), its metadata (`element.meta`:
`language`, `caption`, `listing_no`) and the two blocks on either side of it (`context`).

## Method

1. **Read the prose first.** Find the `context` block that introduces the listing ("Listing 4.1
   simulates…") and any block after it that comments on it. They tell you what the author wants
   the listing to show.
2. **Read the listing** line by line. Identify its inputs, outputs, main loop or control flow,
   and the one or two lines that carry the idea.
3. **Purpose (first block, a `paragraph`).** One to three sentences: what the code does and why
   the book shows it here. Cite the listing anchor and the introducing block.
4. **How it works (optional `steps`).** For listings longer than ~8 lines, 2–6 steps in execution
   order. Name identifiers exactly as written, with `"mark": "code"` on those spans.
5. **Concepts demonstrated (optional `bullets`)** when the listing illustrates more than one idea
   and the prose names them.
6. **Pitfalls.**
   - `callout` tone `antipattern` **only** when the book presents the listing (or part of it) as
     a bad example or warns against what it does.
   - `callout` tone `caution` for a limitation the author states, or one that is plainly visible
     in the code itself (a silently dropped value, an unbounded loop, a shared mutable default).
     Say exactly which line or construct, and cite the listing anchor.
7. **`concepts`.** 1–8 names of the ideas the listing demonstrates — domain or programming
   concepts, not language keywords: lowercase, singular, no articles (`little's law`,
   `work in progress limit`, `discrete-event simulation`). Prefer the book's own term.
8. **`confidence`:**
   - `high`: the listing is complete and well-formed in its language and the prose states its purpose.
   - `medium`: the purpose had to be inferred from the code alone, the language is uncertain, or a line is ambiguous.
   - `low`: extraction damage (lost indentation, mangled symbols, truncated lines), the block is not actually code, or it is too fragmentary to explain.

## Hard rules

1. **Never reproduce, rewrite, fix or extend the listing.** No `code` blocks. Quote an
   identifier or a single short expression inline with `"mark": "code"`, copied character for
   character.
2. **Code runs nowhere.** Never claim what the code prints or returns unless the book states
   it; you may describe what a line does.
3. **Only the given input.** The purpose and any caveat come from the listing and `context`;
   never present outside knowledge (library behaviour, best practice) as the book's claim.
4. **Every span cites ≥ 1 anchor that appears verbatim in the input**: the listing anchor
   (`element.anchor`) for what the code does, the `context` block for what the prose says. Cite
   the most specific block. Never construct, guess or shorten an anchor.
5. **Garbled or non-code input:** return a minimal valid object — one `paragraph` saying only
   what can be read (cited to the listing), `concepts: []` unless the prose names one, and
   `confidence: low`. Do not reconstruct the missing code.
6. Callout tones mean exactly what they say: `antipattern` = the book warns against it;
   `caution` = a stated or visible limitation. Never use a tone to voice your own preference.

## Output

One JSON object: `{"blocks", "concepts", "confidence"}`. `blocks` holds 1–8 render blocks
(`paragraph` first; then any of `steps`, `bullets`, `callout`, `paragraph`, `table`).

## Example

Input (excerpt): `element` = `{"anchor": "ch04/s03/c001", "kind": "code", "meta": {"language": "python", "caption": "Listing 4.1 A toy WIP-limited queue"}, "text": "def simulate(arrival_rate, service_rate, wip_limit, steps=10_000):\n    queue, done, waits = [], 0, []\n    for t in range(steps):\n        if random.random() < arrival_rate and len(queue) < wip_limit:\n            queue.append(t)\n        ..."}`;
`context` includes `ch04/s03/p002` "Listing 4.1 is a toy simulation; run it with and without a limit and compare the average wait." and `ch04/s03/p003` "Notice that the listing simply turns work away at the limit; in a real team that work waits upstream, where no one measures it."

```json
{
  "blocks": [
    {"type": "paragraph", "spans": [
      {"text": "Simulates a single worker pulling from a queue that refuses new work once it holds wip_limit items, and returns throughput and average wait so runs with and without a limit can be compared.", "cites": ["ch04/s03/c001", "ch04/s03/p002"]}]},
    {"type": "callout", "tone": "caution", "title": "Rejected work disappears", "spans": [
      {"text": "Arrivals over the limit are simply not appended, so the model never counts the work waiting upstream; the author notes that in a real team that hidden queue still exists.", "cites": ["ch04/s03/c001", "ch04/s03/p003"]}]}
  ],
  "concepts": ["work in progress limit", "discrete-event simulation"],
  "confidence": "high"
}
```

Output only the JSON object. No prose, no code fences.
