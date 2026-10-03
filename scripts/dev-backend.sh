#!/usr/bin/env bash
# Run the API with its local database: start the Podman Postgres (`scripts/pg-podman.sh`),
# point "This computer" in Settings → Database at it, run `fastapi dev`, and stop the
# container again when the server exits (Ctrl-C included).
#
#   scripts/dev-backend.sh                 # extra arguments go to `fastapi dev`
#   PG_KEEP=1 scripts/dev-backend.sh       # leave the container running afterwards
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG="$ROOT/scripts/pg-podman.sh"

"$PG" start
export BOOKSHELF_LOCAL_DATABASE_URL="$("$PG" url)"

cleanup() {
  if [[ -z "${PG_KEEP:-}" ]]; then
    echo "Stopping the local Postgres…"
    "$PG" stop || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

cd "$ROOT/backend"
uv run fastapi dev app/main.py "$@"
