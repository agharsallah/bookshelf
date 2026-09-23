-- Supabase performance advisor: cover foreign keys used by cascades and joins.
create index nodes_parent_idx on nodes (parent_id);
create index artifacts_note_idx on artifacts (note_id) where note_id is not null;
create index concepts_merged_into_idx on concepts (merged_into) where merged_into is not null;

-- Defence in depth on top of deny-all RLS: the Data API roles get no table grants at
-- all. The backend connects as the owner. Guarded so plain Postgres (no Supabase roles)
-- applies this migration unchanged.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all functions in schema public from anon, authenticated;
    alter default privileges in schema public revoke all on tables from anon, authenticated;
    alter default privileges in schema public revoke all on functions from anon, authenticated;
  end if;
end $$;
