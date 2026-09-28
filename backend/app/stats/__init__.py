"""Pipeline statistics: per book, per chapter, per stage, per skill, and what to improve.

    collect   SQL → facts (the only module that queries)
    facts     plain rows: jobs, CLI calls, artifacts, chapters
    numbers   percentiles, rates, ratios
    tokens    token and cost totals, wasted tokens
    timeline  wall / active / compute time, passes (end-to-end runs), stages, ETA
    chapters  per-chapter cost and quality
    skills    per-skill and per-model figures
    insights  rules that turn the figures into things to change
    service   assembles `DocumentStats` / `LibraryStats` (app/schemas/stats.py)

Everything but `collect` and `service` is pure: facts in, schema models out.
"""
