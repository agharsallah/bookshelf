-- Words per node, counted once when the text is written instead of on every statistics
-- request: splitting every node's text with a regex cost about a second per page of
-- reader or pipeline statistics. Same rule as before (whitespace-separated runs; null
-- text counts 0), so the figures do not change.
alter table nodes add column words integer generated always as (
  coalesce(array_length(regexp_split_to_array(btrim(text), '\s+'), 1), 0)
) stored;
