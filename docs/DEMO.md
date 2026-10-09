# Read-only demo

The `demo` branch deploys the paper shelf as a public showcase: papers only, nothing can be
changed, and nothing runs. The API is on Render (free tier), the frontend on Vercel, the data
in its own Supabase project.

## What is off, and how

| What | How |
|---|---|
| Every write | The backend runs with `ENVIRONMENT=production`, which requires an API key on writes. The frontend is never given it (`API_SECRET` unset), and with `PUBLIC_DEMO=true` its `/api` proxy refuses writes itself with `demo_read_only`. |
| Jobs, embedding, narration, builds | `BOOKSHELF_API_*_RUNNER=false` and `BOOKSHELF_API_WORKER=false` (render.yaml). |
| Adding books or papers, starting jobs, builds, workshop mode, Settings | Marked `data-demo-off`, so `html[data-demo]` greys them out and makes them unclickable (base.css). A banner says why. |
| Books | Not in the data: `scripts/demo/prune-to-papers.sql` deletes them. |
| Figures, audio, search | No media or Qdrant is deployed. Figures, narrations and search do not work. |

## Data

```sh
scripts/demo/build-demo-db.sh                      # local copy → bookshelf_demo → .backups/demo.sql
scripts/demo/build-demo-db.sh '<supabase URL>'     # …and load it into the empty demo project
```

The script reads the local database and never changes it. The pruning runs on a scratch
copy (`bookshelf_demo`).

## Deploy

1. **Supabase**: create an empty project and load the dump into it (above). Use the session
   pooler connection string if the direct one is IPv6-only.
2. **Render**: create a new Blueprint from this repo on the `demo` branch (`render.yaml`).
   Fill in the database URLs (`postgresql+psycopg://…`), `ALLOWED_HOSTS` and `CORS_ORIGINS`.
3. **Vercel**: create a project on the `demo` branch with root directory `frontend`. The
   adapter switches to `@astrojs/vercel` when `VERCEL` is set. Env vars:
   - `PUBLIC_DEMO=true`
   - `PUBLIC_API_URL=https://<render host>/api/v1`
   - `ALLOWED_HOSTS=<vercel host>`

The free Render instance sleeps after 15 minutes idle, so the first page after a pause takes
about a minute.
