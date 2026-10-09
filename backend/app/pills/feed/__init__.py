"""The pills feed (docs/PILLS.md §6): a ranked, seeded query over `pills`, no LLM.

config    FeedConfig: what a feed draws from, how, and for how long
scope     sources → documents, read units by mode, the candidates of a feed
history   what past events say: seen counts, confusing marks, kind affinity signals
rank      pure scoring (scope match * novelty * kind affinity * spacing * draft penalty)
mixer     pure page assembly (bucket mix, active rhythm, unit spacing, threads)
sessions  create, page, resume and finish a session; review pills synthesized at serve time
"""
