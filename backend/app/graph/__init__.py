"""The idea graph (§11): neighborhoods, not nets, and one chapter-grain atlas.

Postgres holds the graph as `concepts` plus the polymorphic `edges` table (D9); every
query is a recursive CTE over it. Modules, bottom up:

* `refs`           the one id scheme for endpoints and evidence (`concept:<uuid>`,
                   `node:<document_id>#<anchor>`, `document:<uuid>`, `artifact:<uuid>`).
* `names`          concept lookup by canonical name or alias, case-insensitively.
* `edges`          edge keys, origins, and `reconcile`: make one document's contribution to
                   a class of edges exactly a desired set, idempotently.
* `apply`          a `concept_links` artifact → concepts + edges (and its withdrawal).
* `diagram_seeds`  diagram nodes/arrows in figure descriptions → candidate edges (§8).
* `mentions`       sections that name a known concept → `mentions` seed edges, across books.
* `dedup`          embedding similarity + a model confirmation → proposed `same_as` edges.
* `merge`          the human-confirmed merge that repoints edges to the survivor.
* `neighborhood`   one focal node, depth ≤ 2, ≤ 150 nodes, edges ranked by weight x evidence.
* `atlas`          the whole shelf at chapter grain: books, chapters, concepts, shared ideas.
* `evidence`       labels and passages for any endpoint or evidence ref, across documents.
* `curation`       human writes: concepts, edges, review of proposals.
* `views`          read models for the API (typeahead, concept pages, merge proposals).
* `pipeline`       the orchestrator effect (`refresh_document`) and the dedup job body.
"""
