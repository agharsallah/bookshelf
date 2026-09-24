-- Notes on the reading pane: a highlight or note may mark a passage of the chapter
-- distillation or summary, not only of the source text.
--
-- `target` says what the note marks. For a pane note, `anchor` is the artifact's own
-- anchor (the chapter), `block` is the index of the render block it sits in, `range`
-- is character offsets into that block's text, and `quote` keeps the marked words so
-- the note still reads well once a newer version replaces the artifact. If that
-- artifact row is deleted the note is kept (`artifact_id` goes null), like notes whose
-- source passage disappears in a re-parse.
alter table notes
  add column target text not null default 'source'
    check (target in ('source', 'chapter_distillation', 'chapter_summary')),
  add column artifact_id uuid references artifacts on delete set null,
  add column block int check (block >= 0),
  add column quote text check (length(quote) between 1 and 2000);

alter table notes add constraint notes_target_shape check (
  (target = 'source' and artifact_id is null and block is null and quote is null)
  or (target <> 'source' and block is not null and range is not null and quote is not null)
);

create index notes_artifact_id_idx on notes (artifact_id);
