# Read-only demo

The `demo` branch deploys the paper shelf as a public showcase: papers only, nothing can be
changed, and nothing runs. The API is on Render (free tier, Frankfurt), the frontend on
Vercel (Hobby, functions in `fra1`), the data in its own database `bookshelf_demo` on the
Postgres VM, read through a role that can only read.

## What is off, and how

| What | How |
|---|---|
| Every write | The database role `bookshelf_demo_ro` has `SELECT` only and `default_transaction_read_only = on`. The backend runs with `ENVIRONMENT=production`, which requires an API key on writes. The frontend is never given it (`API_SECRET` unset), and with `PUBLIC_DEMO=true` its `/api` proxy refuses writes itself with `demo_read_only`. |
| Jobs, embedding, narration, builds | `BOOKSHELF_API_*_RUNNER=false` and `BOOKSHELF_API_WORKER=false` (render.yaml). |
| Adding books or papers, starting jobs, builds, workshop mode, Settings | Marked `data-demo-off`, so `html[data-demo]` greys them out and makes them unclickable (base.css). A banner says why. |
| Where the data lives | Settings shows only what is kept in the browser (look, reading, encouragement); the API runs with `BOOKSHELF_DATABASE_ADMIN=false`, so `/database` and snapshots are not mounted at all. |
| Default tone | Playful (`<html data-cheer-default>`), until a visitor picks one in Settings. |
| Books | Not in the data: `scripts/demo/prune-to-papers.sql` deletes them. |
| Figures, audio, search | No media or Qdrant is deployed. Figures, narrations and search do not work. |

## Data

```sh
scripts/demo/build-demo-db.sh                      # local copy → bookshelf_demo → .backups/demo.sql
scripts/demo/build-demo-db.sh '<target URL>'       # …and load it into an empty database
```

The script reads the local database and never changes it. The pruning runs on a scratch
copy (`bookshelf_demo`). To refresh the deployed data, load into a new empty database on the
VM and point `PGDATABASE` at it, or drop and recreate `bookshelf_demo` (then repeat the role
grants below).

### The read-only role

On the VM, as the owner of `bookshelf_demo`, once per database (the password goes into
`.demo/render-db.env`, which is gitignored, and into Render):

```sql
create role bookshelf_demo_ro login connection limit 10 password '<generated>';
alter role bookshelf_demo_ro set default_transaction_read_only = on;
revoke all on database bookshelf_demo from public;
grant connect on database bookshelf_demo to bookshelf_demo_ro;
grant usage on schema public to bookshelf_demo_ro;
grant select on all tables in schema public to bookshelf_demo_ro;
-- Every table has RLS on with no policy (the Supabase lockdown): let this role read.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('create policy demo_read on public.%I for select to bookshelf_demo_ro using (true)', t);
  end loop;
end $$;
```

## Deploy

Both platforms build the `demo` branch on every push to it.

1. **Render** (`render.yaml`): a free Docker web service `bookshelf-demo-api` in Frankfurt,
   context `backend/`. Secrets set in the dashboard (or MCP): `PGHOST`, `PGPASSWORD` (from
   `.demo/render-db.env`), `BOOKSHELF_API_KEY` (random; nobody is given it),
   `BOOKSHELF_ALLOWED_HOSTS=<render host>`, `BOOKSHELF_CORS_ORIGINS=https://<vercel host>`.
2. **Vercel**: project with root directory `frontend` and production branch `demo`
   (Settings → Environments → Production → Branch Tracking). `frontend/vercel.json` pins the
   functions to `fra1`, next to the API, and skips builds of `main`. The adapter switches to
   `@astrojs/vercel` when `VERCEL` is set. Env vars (Production):
   - `PUBLIC_DEMO=true`
   - `PUBLIC_API_URL=https://<render host>/api/v1`
   - `ALLOWED_HOSTS=<vercel host>`

## Caching

The demo data does not change between deploys, and the free API renders some pages slowly
(the map's atlas takes ~20 s). With `PUBLIC_DEMO` the middleware lets Vercel's CDN keep
every successful GET for a day and serve it stale for a week while it re-renders
(`lib/demo-cache.ts`, `CDN-Cache-Control`). A deployment starts with an empty cache:
redeploy the frontend after reloading the demo data.

## Keeping it awake

The free Render instance sleeps after 15 minutes idle, and the first page after a pause
then takes about a minute. Neither free tier can schedule the fix itself (Render cron jobs
are paid, Vercel Hobby crons run once a day), so a crontab line on the VM pings `/health`
every 10 minutes:

```sh
*/10 * * * * curl -fsS --max-time 120 --retry 2 -o /dev/null https://<render host>/health
```

(`scripts/demo/keep-alive.sh <render URL>` does the same, if the repo is on that machine.)
One service awake all month uses about 744 of the workspace's 750 free instance hours, so
keep any other free Render service suspended.
