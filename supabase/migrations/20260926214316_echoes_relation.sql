-- `echoes`: two chapters whose passages say similar things, found by embedding similarity
-- (app.graph.semantic). Symmetric, derived, rebuilt from Qdrant on every embed job.
alter table edges drop constraint if exists edges_relation_check;
alter table edges add constraint edges_relation_check check (relation in (
  'mentions', 'defines', 'supports', 'contradicts', 'extends',
  'example_of', 'same_as', 'echoes'));
