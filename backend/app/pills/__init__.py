"""Pills (docs/PILLS.md): one-idea, cited learning cards harvested from the shelf's artifacts.

contract   the wire format (mirrors contracts/pill.schema.json)
harvest/   pure harvesters, one per source, registered by artifact type
inputs     what a harvest reads from the database and the disk
store      the idempotent per-document sync of `pills`
serialize  rows → wire pills (document, unit titles, thread sizes, cite sources)
triggers   when a `harvest_pills` job is queued
generate   make-pills top-ups (lazy, budgeted), explicit requests, token estimates
generatable  the chapters make-pills could run on, ranked; a feed config's documents
skill_inputs the `chapter_pills` selector (make-pills' input)
checks     make-pills' cross-field hard gates
feed/      the ranked, seeded feed
"""
