-- Math, explained (docs/PAPERS.md §4): the explain-math skill writes a `math_explainer`
-- artifact, a paper's load-bearing formulas taught to someone with no maths background.
-- Widens the artifact type vocabulary (every value restated).
alter table artifacts drop constraint artifacts_type_check;
alter table artifacts add constraint artifacts_type_check check (type in (
  'outline_override', 'figure_description', 'code_explanation',
  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
  'section_note', 'chapter_distillation', 'book_brief', 'book_guide', 'structured_note',
  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary', 'audio_summary',
  'salience_marks',
  'paper_card', 'paper_explainer', 'claim_set', 'results_table', 'citation_intents',
  'paper_assessment', 'paper_review', 'notation_table', 'journal_club', 'math_explainer'));
