1/
TDD. DDD. BDD.

Say hi to SDD: Skills-Driven Development 🧵

I made the name up, but it's how I built my latest project, and I don't think I'll go back.

---

2/
It started with one flag:

claude -p "..." --model haiku --output-format json

Claude Code runs headless. Your scripts, jobs and workers can call it like any other CLI, on the subscription you already pay for.

No API bill. No SDK. No keys to rotate.

---

3/
So I built Bookshelf 📚

A personal knowledge system that turns books and research papers into distilled, cited notes you can search.

Every sentence links back to the exact paragraph it came from, like `meadows-systems/ch03/s02/p014`.

---

4/
The twist: the logic lives in skills, not in code.

Each skill is a folder:

• SKILL.md → the prompt, in plain English
• schema.json → the output contract
• meta.yaml → version, model tier, quality gates

38 of them so far: distil a chapter, explain a formula, review a paper, write a quiz, script a podcast...

---

5/
The rule that makes it work:

Python decides. Skills judge. JSON crosses the line.

Parsing, hashing, validation, storage → plain code.
"What is this chapter really arguing?" → a skill.

Nothing else crosses the boundary.

---

6/
The cost trick 💸

Every skill declares a tier:

🟢 explore → Haiku (read, classify, transcribe)
🟡 distil → Sonnet (condense, teach)
🔴 reason → Opus (book briefs, paper reviews)

Cheapest model that passes the gates. Every run records which model ran, so you compare with data, not vibes.

---

7/
"But it hallucinates" 👀

So every claim has to cite a source passage. The share of cited claims is a number: the grounding score.

Below 0.9 → it goes to a human review queue. Approve, edit, reject or re-run.

AI never edits my own notes. Ever.

---

8/
Figures and formulas aren't skipped either.

Charts become data. Diagrams become graph edges. Equations become LaTeX plus a symbol-by-symbol explanation.

One small vision call per element, not per page. 40 figures + 20 formulas = 60 calls, not 300.

---

9/
Features I'm proud of:

• a reader that lights up the key ideas
• recall mode: write what you remember, get graded, get spaced-repetition cards
• 5/15/30 min audio summaries with 1 to 4 voices
• a paper mode that explains the maths to non-maths people, with worked examples

---

10/
The best part for an MVP:

Want the glossary less wordy? Edit one sentence in a Markdown file, bump the version.

The input hash changes → only that skill's outputs re-run. Same input twice = zero cost. Never pay twice.

---

11/
The honest part ⚠️

• one subscription doesn't scale to many users
• rate limits cap throughput
• debugging a prompt > debugging a function
• skills need real evals, not just gates

Next up: an eval harness so every prompt change comes with a score, not just a diff.

---

12/
TL;DR

Code for the rules. Skills for the judgement. A JSON contract in between. A human in the loop.

Start small: one skill, one schema, one gate.

Full write-up with the architecture 👇
[link]

Is anyone else building like this? I'd love to compare notes.
