---
name: relate-concepts
description: Decide how two Bookshelf concepts from different books relate (one supports, contradicts, extends or is an example of the other, or they are unrelated), citing a passage from each book, so the idea graph proposes a cross-book edge only when a careful reader of both would draw it. Use when the bridge pass nominates a pair, or when the user asks how an idea in one book bears on an idea in another, e.g. `/relate-concepts <concept-id-a> <concept-id-b>`.
argument-hint: <concept-id-a> <concept-id-b>
---

<!-- interactive:start -->
## Interactive use

`$ARGUMENTS` is `<concept-id-a> <concept-id-b>`. This skill has no inputs endpoint and
stores no artifact; the backend runs it inline during the bridge pass.

1. Fetch both sides with their evidence:
   `curl -s "$BOOKSHELF_API/concepts/<id>"` for each id
   (`$BOOKSHELF_API` defaults to `http://127.0.0.1:8000/api/v1`).
2. Do the work below with the user, reading the evidence passages of both.
3. To record a relation by hand (evidence is qualified anchors, `<document_id>#<anchor>`):
   `curl -s -X POST "$BOOKSHELF_API/edges" -H "X-API-Key: $BOOKSHELF_API_KEY" -H 'content-type: application/json' --data '{"src": "concept:<a>", "dst": "concept:<b>", "relation": "contradicts", "evidence": ["<doc>#<anchor>", "<doc>#<anchor>"]}'`
<!-- interactive:end -->

# Relate two concepts across books

## Role

You connect the shelf across books. The input is one candidate pair, `pair.a` and
`pair.b`, each `{canonical, kind, blurb, book, passages}`, where `passages` are that
book's own words about the concept, each `{id, heading, text}` (`A1`, `A2`… for `a`,
`B1`… for `b`), and `pair.similarity`, how close their embeddings are. Similarity only
nominated the pair; most nominated pairs are **not** related in any way worth a line.
You decide whether a careful reader of both books would draw one, and which.

## Method

1. **Read both sides as claims**: what each book says about its concept, from its
   passages first and its blurb second.
2. **Pick the one relation that holds, reading `a <relation> b`** (or `b <relation> a`):
   - `supports`: one gives evidence, a mechanism or an argument for the other's claim;
   - `contradicts`: they cannot both be followed as stated; one's advice undoes the other's;
   - `extends`: one takes the other further, to a new case, a refinement or a consequence;
   - `example_of`: one is a concrete instance of the other, more general, idea;
   - `none`: they merely share a topic or vocabulary, or the passages are too thin to tell.
3. **Direction**: set `direction` so the sentence reads true: `b_to_a` means `b <relation> a`.
4. **Evidence**: cite the passage ids that show it, at least one from each side. A
   relation you cannot point to in both books is `none`.
5. **Confidence**: `high` when the passages state it outright, `medium` when it follows
   directly from what they state, `low` when it takes an inference a reader could dispute.

## Hard rules

1. **Only the given input.** Judge from the two sides' passages and blurbs; never from
   what you know about the ideas elsewhere.
2. **When in doubt, `none`.** A missed link costs nothing; a wrong one misleads every
   later reading of both books.
3. **Same idea is not a relation here.** If they name the same thing, answer `none`
   with that as the rationale: merging is another skill's job.
4. **`rationale`** is one or two sentences a reviewer can check against the cited
   passages, naming what each book says and why that is the relation.

## Output

One JSON object: `{"relation": "supports" | "contradicts" | "extends" | "example_of" |
"none", "direction": "a_to_b" | "b_to_a", "confidence": "high" | "medium" | "low",
"rationale": str, "evidence": [passage ids]}`.

## Example

Input: `pair.a` = `{"canonical": "move fast and break things", "kind": "concept", "book":
"Mastering Behavioral Interviews", "passages": [{"id": "A1", "text": "Ship before it is
ready; production will tell you what to fix."}]}`, `pair.b` = `{"canonical": "balancing
loop", "kind": "concept", "book": "Flow in Small Teams", "passages": [{"id": "B1", "text":
"A balancing loop pushes a system back toward its goal."}, {"id": "B2", "text": "Push
harder without that brake and the system overshoots."}]}`, `pair.similarity` = 0.66.

```json
{"relation": "contradicts", "direction": "a_to_b", "confidence": "medium", "rationale": "A1 praises shipping before things are ready and fixing in production; B1 says a system corrects itself only when a balancing loop slows it down, and B2 warns that pushing harder without that brake makes it overshoot.", "evidence": ["A1", "B1", "B2"]}
```

Output only the JSON object. No prose, no code fences.
