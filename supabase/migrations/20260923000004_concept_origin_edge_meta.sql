-- Graph curation needs to know who made a concept, and where a proposal came from.
--  * concepts.origin: a withdrawn concept_links artifact may garbage-collect concepts it
--    created, never ones a human created (§11 "human curation stays distinguishable").
--  * edges.meta: similarity score, model rationale and confidence for proposed same_as
--    merges, kept on the edge instead of being dug out of jobs.result.
alter table concepts
  add column origin text not null default 'skill' check (origin in ('human', 'skill'));
alter table edges
  add column meta jsonb not null default '{}';
