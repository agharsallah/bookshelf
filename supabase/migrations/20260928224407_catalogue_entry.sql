-- Library cards (app/pipeline/catalogue.py): the catalogue-document skill writes a
-- `catalogue_entry` artifact, a document's shelf-wide theme, subjects, form, audience,
-- level, one-line description and publication facts. Read where it is shown, never copied
-- onto `documents`, so this only widens the artifact type vocabulary (every value restated).
alter table artifacts drop constraint artifacts_type_check;
alter table artifacts add constraint artifacts_type_check check (type in (
  'outline_override', 'figure_description', 'code_explanation',
  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
  'section_note', 'chapter_distillation', 'book_brief', 'book_guide', 'structured_note',
  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary', 'audio_summary',
  'salience_marks',
  'paper_card', 'paper_explainer', 'claim_set', 'results_table', 'citation_intents',
  'paper_assessment', 'paper_review', 'notation_table', 'journal_club', 'math_explainer',
  'catalogue_entry'));
