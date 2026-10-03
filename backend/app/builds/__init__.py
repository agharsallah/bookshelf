"""Builds (docs/BUILDS.md): from a paper to a repository.

A build is planned by the `plan-build` utility skill (`planning`), approved by you, then
built by an agent package (`agents/<name>/`, `agents`) in a fresh git checkout outside this
repo (`runner`). `service` holds the state machine; `preflight` says up front what is
missing; `context` writes the paper's ideas, citations stripped, as `docs/PAPER.md`.
"""
