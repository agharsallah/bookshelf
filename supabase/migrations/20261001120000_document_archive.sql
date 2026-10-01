-- Archive: a document put away without losing anything. `archived_at` set hides it from
-- the library, search and the review queue and holds its queued work; clearing it
-- restores the document as it was. Null means on the shelf.
alter table documents add column archived_at timestamptz;
create index documents_archived_idx on documents (archived_at) where archived_at is not null;
