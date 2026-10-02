-- Finished: a document you have read through, whatever its chapter positions say (the last
-- lines of a chapter rarely cross the reading line, and front matter is seldom read). Set
-- by hand or by moving on to the next document of a collection; null means not finished.
alter table documents add column finished_at timestamptz;
