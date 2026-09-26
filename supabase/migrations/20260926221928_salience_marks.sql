-- Salience marks (skills/mark-salience): what matters in a chapter, in its own words. Core
-- ideas and key points as verbatim sentences, terms where the chapter defines them, each
-- citing the one block it is copied from. The reader's "Mark what matters" mode shows them
-- over the source text, in place of the marks it otherwise infers from the notes' cites.
alter table artifacts drop constraint artifacts_type_check;
alter table artifacts add constraint artifacts_type_check check (type in (
  'outline_override', 'figure_description', 'code_explanation',
  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
  'section_note', 'chapter_distillation', 'book_brief', 'book_guide', 'structured_note',
  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary', 'audio_summary',
  'salience_marks'));
