"""Reader statistics: how you read, listen, annotate and remember, per book and chapter.

    collect    SQL → facts (the only module that queries)
    facts      plain rows: minutes of attention, positions, notes, recalls, reviews, cards
    clock      local days and hours in the reader's time zone
    attention  time per surface, day, weekday x hour; sessions and streaks
    books      per-book and per-chapter progress, time, pace, notes, recall
    passages   most visited and most annotated passages
    notes      counts, lengths, colors, chapters without notes
    memory     recall grades and trend, reviews, retention, cards due
    concepts   the ideas you spent time with
    insights   rules that turn the figures into observations about you
    service    assembles `LibraryReaderStats` / `BookReaderStats` (app/schemas/reader_stats.py)

Everything but `collect` and `service` is pure: facts in, schema models out.
"""
