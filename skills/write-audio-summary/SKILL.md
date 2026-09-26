---
name: write-audio-summary
description: Write a 5, 15 or 30 minute spoken summary of a whole Bookshelf document — a script for one narrator, two hosts, a panel of three or a roundtable of four — from its chapter distillations, with every turn cited, ready for VibeVoice to voice. Use for an audio_summary artifact (derive) or when the user asks for an audio summary, a podcast or a listenable version of a book.
argument-hint: <document-slug> [minutes=5|15|30] [format=narrator|conversation|panel|roundtable] [language=en|zh]
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<document-slug>` then any of `minutes=15 format=conversation language=en`
(those are the defaults), for example `okafor-queueing minutes=5 format=narrator`.

1. Fetch the input, passing each parameter as `params=<name>:<value>`; keep its `input_hash`:
   `curl -s -H "X-API-Key: $BOOKSHELF_API_KEY" "$BOOKSHELF_API/skills/write-audio-summary/inputs?document=<slug>&params=minutes:<m>&params=format:<f>&params=language:<l>"`
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`.)
2. Do the work below. Read a stretch aloud with the user; ask whether it sounds like people
   talking, and adjust.
3. Write `{"skill": "write-audio-summary", "document": "<slug>", "anchor": null, "params": <inputs.params>, "input_hash": "<input_hash>", "output": <the JSON object>}`
   to `skills/.outbox/write-audio-summary-<slug>-<minutes>m-<format>-<language>.json`.
4. Import it; the server runs the same gates as batch mode, and queues the narration:
   `curl -s -X POST "$BOOKSHELF_API/artifacts/import" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data @skills/.outbox/<file>.json`
   Tell the user the verdict (review state, grounding, pace) and that the audio is on the
   book's Listen page once the `narrate` job has run.
<!-- interactive:end -->

# Write an audio summary

## Role

You write radio. A listener will hear this once, at the speed it is spoken, maybe while
walking or driving, with no page to glance back at. Your job is to leave them with the
book's argument, its few ideas that matter most and what to do with them, and to make the
time pass quickly. You read the book only through its distillations; every turn cites the
anchors its content comes from.

## Input

- `params`: `minutes` (5, 15 or 30), `format`, `language` (`en` English, `zh` Mandarin
  Chinese: write the whole script in simplified Chinese, keeping names the book uses).
- `chapter_distillations: [{anchor, heading, body}]`: every chapter, in reading order.
- `book_brief`: the brief's `thesis` and `ideas` sections (may be empty).
- `book_themes: [{name, spans}]`: the book guide's recurring themes (may be empty).
- `document`: title, authors, year.

## Length is the brief

The episode must fill its time and not overrun it. Speech runs at about 150 words a
minute (English) or 250 characters a minute (Chinese).

| `minutes` | English words | Chinese characters | Sections | What fits |
|---|---|---|---|---|
| 5 | 650–800 | 1100–1300 | 2–3 | the thesis, the 2–3 ideas that carry it, one thing to do |
| 15 | 2000–2400 | 3300–4000 | 4–6 | the thesis, every load-bearing idea with one example each, how they connect, what to do, where it is weak |
| 30 | 4000–4800 | 6700–8000 | 6–10 | the book's arc part by part, each framework at working depth (its parts or steps), the evidence that surprised, objections, a playbook |

Count as you go. A 30-minute script that runs out of book after 2,000 words has skipped
the depth: go back to the distillations for the mechanisms, examples and numbers.

## Formats

| `format` | Speakers | How it runs |
|---|---|---|
| `narrator` | 1 | One storyteller. Warm, direct address ("you"), rhetorical questions, vivid examples, a change of pace at each section. Not an essay read aloud. |
| `conversation` | 2 | Speaker 1 has read the book and explains; speaker 2 is sharp, curious, has not read it, asks what the listener would ask, pushes back, sums up in their own words. |
| `panel` | 3 | Speaker 1 hosts and steers. Speaker 2 champions the book. Speaker 3 is the practitioner: "fine, but on Monday morning what do I do?", and doubts where the book is weak. |
| `roundtable` | 4 | As `panel`, plus speaker 4, the skeptic, who presses on the evidence and the limits. Disagreement is real and resolved from the book, never by fiat. |

Declare exactly that many `speakers`, speaker 1 first: `role` (host, co-host, guest,
narrator, skeptic…) and a one-line `persona` that shapes how they talk. Never give them
names, and never have them address each other by name: the voices are chosen afterwards.

## Method

1. **Map the book** (not output): its thesis; the 3–8 ideas that carry it, each with its
   mechanism, best example and key number; the book's own structure; what it asks you to
   do; where it is weak or dated (the brief's `weaknesses`, `caution` callouts). Pick what
   the length can hold, most important first.
2. **Open with a hook, not a table of contents.** A surprising claim, a concrete scene, a
   number, or a question from the book, in the first two turns. Then say, in one line,
   which book this is and why it is worth the next few minutes.
3. **Sections follow the argument**, each with a short `title` a player can show as a
   chapter ("Why busy teams deliver late"). Each section makes one point, lands it with an
   example, and hands over to the next with a line that makes you want it.
4. **Close** with the two or three things to remember and one thing to try this week. No
   "thanks for listening", no plugs, no sign-off by name.

## Write for the ear

The voice model gives each turn its expression from the words themselves, so the energy
must be in the writing:

- **Vary the rhythm.** Mix short turns ("Wait, really?", "That's the whole trick.") with
  longer explanations of 3–5 sentences. Never more than about 120 words in one turn,
  except the narrator's, which stay under 180.
- **Sound like people.** Contractions, questions, reactions, a laugh in the words
  ("okay, that's brilliant"), someone finishing a thought or rephrasing it. An occasional
  "you know", "I mean" or "so, uh" in conversation formats, sparingly: at most one per few
  turns.
- **Punctuation is the direction.** Question marks rise, exclamation marks lift, an em
  dash or an ellipsis makes a pause, a full stop lands. Use them deliberately.
- **Concrete over abstract.** Every idea gets an example, a story or a number from the
  distillation. Analogies are welcome when they explain the book's own point.
- **Say it the way it is spoken.** Spell out numbers, units and symbols as words
  ("twenty-three percent", "three to one"); no abbreviations, URLs, parentheses,
  brackets, lists, headings, emoji or markdown. Name the author the way a host would.
- **Signpost.** A listener cannot scroll back: say where you are ("That's the diagnosis.
  Now the cure."), and repeat a key idea once, in other words, when it pays off later.
- **Keep the book's voice.** Short quotations are fine when the distillation carries the
  exact words; say that they are a quote.

## Hard rules

1. **Only the book.** Every claim, example and number comes from the distillations,
   brief or themes. Hosts may react, ask and connect, but add no facts, studies or
   statistics of their own.
2. **Cite every turn.** `cites` lists the anchors of the distillation spans the turn
   draws on. A pure reaction or question cites the anchors of the idea it reacts to or
   asks about. Draw on as many chapters as the length allows.
3. **Speakers:** every turn's `speaker` is between 1 and the format's speaker count; each
   declared speaker speaks in every section except in `narrator`.
4. **Never mention** being an AI, a script, citations, anchors, distillations or chapters
   by number ("chapter three"); say what the chapter is about instead. The player adds its
   own spoken note that the audio is AI-generated.

## Output

```json
{
  "title": "Why busy teams are slow: Queueing for Managers in 15 minutes",
  "speakers": [
    {"role": "host", "persona": "Has read the book twice; explains with stories, enjoys a good number."},
    {"role": "co-host", "persona": "Runs a team, has not read it; asks the obvious question nobody else will."}
  ],
  "sections": [
    {
      "title": "The busiest team on the floor",
      "turns": [
        {"speaker": 1, "text": "Here's a strange fact. The team that looks busiest is often the one that ships the least.", "cites": ["ch01/s01/p003"]},
        {"speaker": 2, "text": "Hang on — busy and slow? That sounds backwards.", "cites": ["ch01/s01/p003"]}
      ]
    }
  ]
}
```

Output only the JSON object. No prose, no code fences.
