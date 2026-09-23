-- Plain highlights: a note may carry no words of its own (`raw` null). Only notes with
-- words queue `structure_note`, so a highlight costs no model call.
alter table notes alter column raw drop not null;

-- D11 still holds for words once written: a highlight may gain its `raw` exactly once
-- (null -> text); after that `raw` never changes, and never goes back to null.
-- The length check (1..20000) still applies whenever `raw` is present.
create or replace function notes_raw_is_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.raw is not null and new.raw is distinct from old.raw then
    raise exception 'notes.raw is immutable (D11)';
  end if;
  return new;
end $$;
