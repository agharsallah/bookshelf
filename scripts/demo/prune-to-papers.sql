-- Prune a copy of the shelf down to its papers, for the read-only demo (docs/DEMO.md).
-- Run it on a throwaway copy, never on the real database: it deletes every book.
--
-- Most rows follow their document through `on delete cascade`. Edges are polymorphic
-- (text ids, a node's id is `<document id>#<anchor>`), so they are cleaned by hand, and
-- concepts left with no edge at all go with them.
begin;

-- Books out: every document without paper metadata.
delete from documents d
where not exists (select 1 from paper_meta pm where pm.document_id = d.id);

-- Nothing runs in the demo: drop the queue's unfinished work and the worker registry.
delete from jobs where state <> 'succeeded';
delete from workers;
update app_settings set data = jsonb_set(data, '{queue,paused}', 'true', true);

-- Edges whose node, document or claim endpoint went with a book.
delete from edges e
where (e.src_kind in ('node', 'document')
       and not exists (select 1 from documents d where d.id::text = split_part(e.src_id, '#', 1)))
   or (e.dst_kind in ('node', 'document')
       and not exists (select 1 from documents d where d.id::text = split_part(e.dst_id, '#', 1)))
   or (e.src_kind = 'claim' and not exists (select 1 from claims c where c.id::text = e.src_id))
   or (e.dst_kind = 'claim' and not exists (select 1 from claims c where c.id::text = e.dst_id));

-- Concepts only books mentioned, then concept-to-concept edges left pointing at them.
delete from concepts c
where not exists (
  select 1 from edges e
  where (e.dst_kind = 'concept' and e.dst_id = c.id::text and e.src_kind <> 'concept')
     or (e.src_kind = 'concept' and e.src_id = c.id::text and e.dst_kind <> 'concept')
);
delete from edges e
where (e.src_kind = 'concept' and not exists (select 1 from concepts c where c.id::text = e.src_id))
   or (e.dst_kind = 'concept' and not exists (select 1 from concepts c where c.id::text = e.dst_id));

-- Collections the papers do not fill.
delete from collections c
where not exists (select 1 from collection_members m where m.collection_id = c.id);

commit;
