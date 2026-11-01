-- A composed reading edition (compose-reading): one linked document woven from the
-- approved distillations, summaries and notes. The reading PDF can print it; the
-- assembled PDF does not wait for it. This only widens the artifact type vocabulary.
alter table artifacts drop constraint artifacts_type_check;
alter table artifacts add constraint artifacts_type_check check (type in (
  'outline_override', 'figure_description', 'code_explanation',
  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
  'section_note', 'chapter_distillation', 'book_brief', 'book_guide', 'structured_note',
  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary', 'audio_summary',
  'salience_marks',
  'paper_card', 'paper_explainer', 'claim_set', 'results_table', 'citation_intents',
  'paper_assessment', 'paper_review', 'notation_table', 'journal_club', 'math_explainer',
  'catalogue_entry', 'pill_set', 'reading_edition'));
