-- EPUB books (app/pipeline/parse/epub): parsed from the book's own structure (spine,
-- table of contents, XHTML), so they get their own kind next to 'pdf' and 'article'.
alter table documents drop constraint documents_kind_check;
alter table documents add constraint documents_kind_check
  check (kind in ('pdf', 'epub', 'article'));
