-- Audio summaries (skills/write-audio-summary): a spoken 5, 15 or 30 minute summary of a
-- book, as a narrator, a two-host conversation or a panel, in English or Chinese. The
-- script is an artifact like any other; the audio is derived media, made by a `narrate`
-- job (VibeVoice, scripts/narrate/) and kept on disk, never in the database.
--
-- One book has many episodes (5 min conversation, 30 min panel, ...), each with its own
-- history, so artifacts gain a `variant`: the run's parameters as a short key
-- (`15m-conversation-en`). It joins the scope in the per-scope version counter; every
-- other type leaves it null and keeps its versions exactly as before.
alter table artifacts
  add column variant text check (variant ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(variant) <= 100);

alter table artifacts drop constraint artifacts_document_id_anchor_type_version_key;
alter table artifacts add constraint artifacts_scope_version_key
  unique nulls not distinct (document_id, anchor, type, variant, version);

alter table artifacts drop constraint artifacts_type_check;
alter table artifacts add constraint artifacts_type_check check (type in (
  'outline_override', 'figure_description', 'code_explanation',
  'math_description', 'table_explanation', 'chapter_summary', 'book_summary',
  'section_note', 'chapter_distillation', 'book_brief', 'book_guide', 'structured_note',
  'concept_links', 'quote_set', 'faq', 'quiz', 'flashcards', 'glossary', 'audio_summary'));

alter table jobs drop constraint jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in (
  'parse', 'describe_figure', 'explain_code', 'describe_math', 'explain_table',
  'summarize', 'distil_section', 'distil_chapter', 'brief', 'structure_note',
  'embed', 'link_concepts', 'derive', 'export', 'narrate'));
