-- The book guide (skills/write-guide): the in-depth, visual companion to the one-page
-- brief. A new artifact type only; it is produced by a `derive` job, so jobs.kind is
-- unchanged.
alter table artifacts drop constraint artifacts_type_check;
alter table artifacts add constraint artifacts_type_check check (type in (
  'outline_override', 'figure_description', 'code_explanation',
  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
  'section_note', 'chapter_distillation', 'book_brief', 'book_guide', 'structured_note',
  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary'));
