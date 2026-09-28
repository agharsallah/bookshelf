"""Pipeline telemetry: what every model call cost, recorded where it happens.

`recorder` wraps a `ModelRunner` so each `claude -p` call a job makes leaves one
`model_runs` row, failed calls included. `app.stats` reads those rows (and `jobs`,
`artifacts`) back into per-book and per-skill statistics.
"""
