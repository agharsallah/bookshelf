#!/usr/bin/env bash
# Project-local Postgres for development and tests.
#
# Runs an isolated cluster in .pgdata/ on port 54329 with trust auth on localhost only,
# so it never collides with a system Postgres and needs no password. Production data
# lives in Supabase; this cluster is disposable.
#
#   scripts/pg-local.sh start     # init on first run, then start
#   scripts/pg-local.sh stop
#   scripts/pg-local.sh status
#   scripts/pg-local.sh reset     # stop, wipe, re-init, re-migrate
#
# Override the binaries with PG_BIN=/path/to/bin if autodetection picks the wrong one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/.pgdata"
PORT="${PG_LOCAL_PORT:-54329}"
DB="${PG_LOCAL_DB:-bookshelf}"
USER_NAME="bookshelf"

find_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then echo "$PG_BIN"; return; fi
  for candidate in \
    /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin \
    /Library/PostgreSQL/17/bin /Library/PostgreSQL/16/bin /Library/PostgreSQL/15/bin \
    /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin; do
    [[ -x "$candidate/initdb" ]] && { echo "$candidate"; return; }
  done
  command -v initdb >/dev/null && { dirname "$(command -v initdb)"; return; }
  echo "No Postgres server binaries found; set PG_BIN." >&2
  exit 1
}

BIN="$(find_bin)"
psql_local() { "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" -v ON_ERROR_STOP=1 -q "$@"; }

init() {
  [[ -d "$DATA" ]] && return
  "$BIN/initdb" -D "$DATA" -U "$USER_NAME" --auth=trust --encoding=UTF8 --locale=C >/dev/null
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = $PORT"
    echo "unix_socket_directories = '$DATA'"
    echo "fsync = off"                 # disposable dev/test cluster: speed over durability
    echo "synchronous_commit = off"
    echo "full_page_writes = off"
  } >> "$DATA/postgresql.conf"
}

start() {
  init
  if ! "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
    "$BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w start >/dev/null
  fi
  if ! psql_local -d postgres -Atc "select 1 from pg_database where datname = '$DB'" | grep -q 1; then
    psql_local -d postgres -c "create database $DB"
    (cd "$ROOT/backend" && BOOKSHELF_DATABASE_URL="$(url)" uv run python -m app.db.migrate)
  fi
  echo "Postgres ready: $(url)"
}

url() { echo "postgresql+psycopg://$USER_NAME@127.0.0.1:$PORT/$DB"; }

case "${1:-start}" in
  start)  start ;;
  stop)   "$BIN/pg_ctl" -D "$DATA" -w stop >/dev/null && echo "stopped" ;;
  status) "$BIN/pg_ctl" -D "$DATA" status ;;
  url)    url ;;
  reset)  "$BIN/pg_ctl" -D "$DATA" -w stop >/dev/null 2>&1 || true; rm -rf "$DATA"; start ;;
  *) echo "usage: $0 {start|stop|status|url|reset}" >&2; exit 2 ;;
esac
