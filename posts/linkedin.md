We've all heard of TDD, DDD and BDD.

Let me add one more to the list: SDD, Skills-Driven Development.

Yes, I made the name up. But the idea behind it has changed how I build things.

It started with a small discovery: Claude Code can run headless from the terminal with `claude -p`. Suddenly my code could call a capable model like any other command, through the subscription already paid for. No API bill, no SDK, no keys.

So I built Bookshelf as a side project, a personal knowledge system that turns books and research papers into cited, searchable notes. And I built it around skills instead of code.

Here's the approach:

→ Every skill is a folder: a SKILL.md (the prompt, in plain English), a schema.json (the output contract) and a meta.yaml (version, model tier, quality gates).
→ Python handles everything that follows rules: parsing, hashing, validation, storage. Skills handle everything that needs judgement. JSON is the only thing that crosses between them.
→ Each skill picks the cheapest model that does the job well. Haiku reads and transcribes, Sonnet distils and teaches, Opus writes the briefs and reviews papers. 38 skills, three tiers.
→ Every generated sentence has to cite the passage it came from. If fewer than 90% of statements are cited, the output goes to a human review queue.

What surprised me most: changing behaviour usually means editing a sentence in a Markdown file, not touching the codebase. Bump the version, and the system re-runs only what that skill produced.

It's not a silver bullet. On one person's subscription it doesn't scale to many users, debugging a prompt is harder than debugging a function, and evaluating skills properly takes real work.

But for an MVP or a personal tool, I haven't found a faster way to build while still seeing whether the quality holds up.

I wrote up the full architecture, the features and the trade-offs. Link in the comments.

Curious: is anyone else building with skills at the centre? What's working for you?

#AI #SoftwareEngineering #ClaudeCode #LLM #DeveloperExperience
