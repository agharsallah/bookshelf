#!/usr/bin/env bash
# Build the read-only demo database: the papers on the local shelf, nothing else
# (docs/DEMO.md).
#
# Copies the local database into a scratch database `bookshelf_demo` on the same cluster,
# prunes it to papers (prune-to-papers.sql) and dumps it to .backups/demo.sql. With a
# target URL it also loads the dump there; the target must be an empty database.
#
#   scripts/demo/build-demo-db.sh                                   # build + dump only
#   scripts/demo/build-demo-db.sh 'postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres'
#
# The real local database is only read. Override the source with SOURCE_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_URL="${SOURCE_URL:-postgresql://bookshelf@127.0.0.1:54329/bookshelf}"
SCRATCH_URL="${SOURCE_URL%/*}/bookshelf_demo"
DUMP="$ROOT/.backups/demo.sql"
TARGET_URL="${1:-}"

psql_() { psql -X -v ON_ERROR_STOP=1 -q "$@"; }
# A newer pg_dump than the server writes settings the server does not know, and a
# `--schema=public` dump creates the schema every new database already has.
dump() {
  pg_dump --no-owner --no-privileges "$@" | grep -v '^SET transaction_timeout' |
    sed 's/^CREATE SCHEMA public;$/CREATE SCHEMA IF NOT EXISTS public;/'
}

echo "Copying the local shelf into bookshelf_demo…"
psql_ "$SOURCE_URL" -c "drop database if exists bookshelf_demo" -c "create database bookshelf_demo"
dump "$SOURCE_URL" | psql_ "$SCRATCH_URL" >/dev/null

echo "Pruning it to papers…"
psql_ "$SCRATCH_URL" -f "$ROOT/scripts/demo/prune-to-papers.sql"
psql -X -At "$SCRATCH_URL" -c "select 'documents left: ' || count(*) from documents"

mkdir -p "$(dirname "$DUMP")"
dump --schema=public "$SCRATCH_URL" >"$DUMP"
echo "Dump written to $DUMP"

if [[ -n "$TARGET_URL" ]]; then
  echo "Loading it into the target…"
  psql_ "$TARGET_URL" -f "$DUMP" >/dev/null
  echo "Done."
fi
