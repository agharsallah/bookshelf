---
name: make-pills
description: Compose learning pills for one chapter of a Bookshelf document — hooks that make you care, threads of 3–6 pills that tell the chapter's arc in order, and short headlines — from its distillation, every span cited, without restating pills already harvested from its other study material. Use for a pill_set artifact (derive, queued lazily when the pills feed runs low) or when the user asks for pills, reels or a swipeable feed for a chapter anchor such as `ch03`.
argument-hint: <document-slug> <chapter-anchor> [style=plain|story|socratic]
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug> <chapter-anchor>` then optionally `style=plain` (the
default), `style=story` or `style=socratic`, for example `okafor-queueing ch03 style=story`.

1. Fetch the input — the response's `inputs` is the exact JSON the batch runner would send; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/make-pills/inputs?document=<slug>&anchor=<anchor>&params=style:<style>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below; show the user the thread before writing the rest.
3. Write `{"skill": "make-pills", "document": "<slug>", "anchor": "<anchor>", "params": <inputs.params>, "input_hash": "<input_hash from the response>", "output": <the JSON object>}`
   to `skills/.outbox/make-pills-<slug>-<anchor with / replaced by ->-<style>.json`.
4. Import it; the server runs the same schema, anchor, duplicate and pill-length gates as batch mode, then harvests the pills:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, flags) and that the pills join the feed at `/pills`.
<!-- interactive:end -->

# Make pills

## Role

You write the cards of a learning feed: one idea per screen, read in 15–60 seconds, each
one tap from the passage it rests on. Most pills are already harvested from the chapter's
study material (`harvested`: kind and opening words of each). You write what harvesting
cannot: **hooks** (why care, then the payoff), **threads** that tell the chapter's arc in
order, and **headlines**.

Input: `document.title` and `scope.heading` (the book and chapter), `distillation` (the
chapter's cited study note, your only source), `salience` (the chapter's own core and key
sentences, or null: a hint of what matters), `harvested`, and `params.style`.

## Method

1. **Find the arc.** From the distillation (and `salience` when given): the question the
   chapter answers, the turn, the conclusion. That is one thread; a long chapter may have two.
2. **Write each thread: 3–6 pills, in reading order.** Open with a `hook`: `spans` pose the
   tension or question in the reader's world, `payoff` resolves it. Then the steps of the
   arc, one idea per pill, using the kind that fits: `insight` (`spans`, optional `why`),
   `remember`, `antipattern`, `definition` (`term`, `spans`), `quiz` (`question`, 3–4
   `choices`, 0-based `answer`, `explanation`) or `flip` (`front`, `back`). Put at least
   one `quiz` or `flip` in each thread. `title`: what the thread is about, ≤ 80 chars.
3. **Add up to 10 standalone `pills`** for strong ideas the threads leave out.
4. **Headline every pill**: 2–8 words, concrete, no clickbait, no colon-subtitle.
5. **Skip the harvested.** A pill whose idea a `harvested` entry already states is not
   written, in any wording. Threads may still cover such an idea only through a new angle
   (a hook, a quiz on it).
6. **Style** (`params.style`): `plain` — direct statements; `story` — a small scene or
   example carries each idea (from the distillation, not invented facts); `socratic` — ask
   first, then answer (more hooks, quizzes and flips).

## Hard rules

1. **Only the distillation's claims.** No outside facts, numbers or examples presented as the
   book's. A hook's scenario may be generic ("your team is fully booked"), its claim may not.
2. **Every span cites ≥ 1 anchor** copied verbatim from the distillation's spans (the source
   blocks they cite), most specific first; a pill's `cites` lists every anchor its body cites.
   Never cite the chapter anchor itself; never construct or guess an anchor.
3. **One idea per pill; its body reads 8–60 words** (headline excluded).
4. **No repeats**: never restate a `harvested` entry or another pill of yours.
5. **Quizzes**: one right answer, plausible distractors from the chapter, `answer` indexes
   `choices`.
6. **Thin input:** fewer pills; `{"threads": [], "pills": []}` if nothing new is left. Never pad.
7. Write in the language of the distillation.

## Output

One JSON object: `{"threads": [{"title", "pills": [pill × 3–6]}], "pills": [pill]}`, each
pill `{"kind", "headline", "body", "cites"}`.

## Example

Input (excerpt): `scope.heading` "Utilization Is a Trap"; the distillation states that past a
point each percent of utilization buys disproportionate waiting (`ch03/s01/p001`), 90% → 9×,
95% → 19× (`ch03/s01/p004`), variability is the other half (`ch03/s02/p003`), Kingman's
formula (`ch03/s02/p005`), slack as reserve capacity (`ch03/s03/p001`); `harvested` already
has a definition of "slack".

```json
{"threads": [{"title": "Why the busiest team is the slowest", "pills": [
  {"kind": "hook", "headline": "Full calendars, empty progress", "body": {
    "spans": [{"text": "Your team is booked to 100% and still misses every date. How can more busyness mean less done?", "cites": ["ch03/s01/p001"]}],
    "payoff": [{"text": "Past a point, every extra percent of load buys a disproportionate amount of waiting.", "cites": ["ch03/s01/p001"]}]}, "cites": ["ch03/s01/p001"]},
  {"kind": "insight", "headline": "The curve bends hard at 90%", "body": {
    "spans": [{"text": "At 90% utilization work waits nine times as long as it takes; at 95%, nineteen times.", "cites": ["ch03/s01/p004"]}]}, "cites": ["ch03/s01/p004"]},
  {"kind": "quiz", "headline": "Half the story", "body": {"question": "Load is only half of what makes work wait. What is the other half?",
    "choices": ["Team size", "Variability", "Meeting load"], "answer": 1,
    "explanation": [{"text": "Utilization is half the story; variability in arrivals and work sizes is the other.", "cites": ["ch03/s02/p003"]}]}, "cites": ["ch03/s02/p003"]}]}],
 "pills": [{"kind": "flip", "headline": "Kingman in one line", "body": {"front": "Kingman's formula: queue time is a product of which three terms?",
    "back": [{"text": "A utilization term, a variability term and the mean service time.", "cites": ["ch03/s02/p005"]}]}, "cites": ["ch03/s02/p005"]}]}
```

Output only the JSON object. No prose, no code fences.
