-- Notes are source of truth (D11); nodes are rebuilt by re-parsing. A cascading FK from
-- notes to nodes(document_id, anchor) meant a re-parse could silently delete notes.
-- Notes now reference only their document; the parser upserts nodes by anchor so
-- surviving anchors keep their rows, and a note whose anchor vanished is shown as
-- detached instead of being dropped.
alter table notes drop constraint notes_document_id_anchor_fkey;
