-- Live-work dedupe covers queued jobs only (it covered queued and running).
--
-- With `running` in the index, work requested while an identical job was running was
-- silently dropped: approve a corrected section note while its chapter distils, and the
-- chapter was never re-distilled from the new note. Now one follow-up may wait in the
-- queue behind the running job; `claim()` does not start it until that job has finished,
-- so the same (kind, document, anchor, input_hash) still never runs twice at once.
drop index if exists jobs_dedupe_idx;
create unique index jobs_dedupe_idx
  on jobs (kind, coalesce(document_id::text, ''), coalesce(anchor, ''), coalesce(input_hash, ''))
  where state = 'queued';
