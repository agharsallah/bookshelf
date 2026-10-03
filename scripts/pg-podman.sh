#!/usr/bin/env bash
# A small Postgres in a Podman container: "This computer" in Settings → Database.
#
# Postgres 17 (Supabase's major version), trust auth, bound to 127.0.0.1 only, data in a
# named volume so it survives stop/start. Port 54330, so it never collides with the native
# cluster of `scripts/pg-local.sh` (54329), which the tests keep using.
#
#   scripts/pg-podman.sh start     # start the Podman VM if needed, the container, migrate
#   scripts/pg-podman.sh stop      # stop the container (data kept)
#   scripts/pg-podman.sh status
#   scripts/pg-podman.sh url       # the BOOKSHELF_LOCAL_DATABASE_URL to use
#   scripts/pg-podman.sh logs
#   scripts/pg-podman.sh reset     # remove the container AND its data, start again
#
# `scripts/dev-backend.sh` starts it with the API and stops it when the API exits.
set -euo pipefail

# The official macOS installer keeps the VM helpers (krunkit, vfkit, gvproxy) here; a
# Homebrew podman earlier on PATH cannot start a libkrun machine without them.
[[ -d /opt/podman/bin ]] && export PATH="/opt/podman/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${PG_PODMAN_NAME:-bookshelf-pg}"
VOLUME="${NAME}-data"
IMAGE="${PG_PODMAN_IMAGE:-docker.io/library/postgres:17-alpine}"
PORT="${PG_PODMAN_PORT:-54330}"
DB="bookshelf"
USER_NAME="bookshelf"

url() { echo "postgresql+psycopg://$USER_NAME@127.0.0.1:$PORT/$DB"; }

machine_up() {
  # macOS/Windows run containers in a VM; Linux has none (the command fails, that's fine).
  if podman machine inspect >/dev/null 2>&1; then
    if [[ "$(podman machine inspect --format '{{.State}}')" != "running" ]]; then
      echo "Starting the Podman machine…"
      podman machine start >/dev/null
    fi
  fi
}

exists() { podman container exists "$NAME" 2>/dev/null; }
running() { [[ "$(podman inspect --format '{{.State.Running}}' "$NAME" 2>/dev/null)" == "true" ]]; }

wait_ready() {
  for _ in $(seq 1 60); do
    podman exec "$NAME" pg_isready -q -U "$USER_NAME" -d "$DB" && return 0
    sleep 0.5
  done
  echo "Postgres did not become ready; see: $0 logs" >&2
  exit 1
}

start() {
  machine_up
  if ! exists; then
    # Small on purpose: a single-user library needs little memory.
    podman run -d --name "$NAME" \
      -p "127.0.0.1:$PORT:5432" \
      -v "$VOLUME:/var/lib/postgresql/data" \
      -e POSTGRES_USER="$USER_NAME" -e POSTGRES_DB="$DB" \
      -e POSTGRES_HOST_AUTH_METHOD=trust \
      --memory 512m --shm-size 128m \
      "$IMAGE" \
      -c shared_buffers=64MB -c max_connections=40 -c work_mem=8MB >/dev/null
  elif ! running; then
    podman start "$NAME" >/dev/null
  fi
  wait_ready
  local log
  if ! log="$(cd "$ROOT/backend" && BOOKSHELF_DATABASE_URL="$(url)" uv run python -m app.db.migrate 2>&1)"; then
    echo "$log" >&2
    exit 1
  fi
  echo "${log##*$'\n'}"  # its last line: how many migrations were applied
  echo "Postgres ready: $(url)"
}

stop() {
  if exists && running; then
    podman stop -t 10 "$NAME" >/dev/null
    echo "stopped"
  else
    echo "not running"
  fi
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop ;;
  status) if exists && running; then echo "running: $(url)"; else echo "stopped"; fi ;;
  url)    url ;;
  logs)   podman logs --tail 50 "$NAME" ;;
  reset)
    machine_up
    podman rm -f "$NAME" >/dev/null 2>&1 || true
    podman volume rm -f "$VOLUME" >/dev/null 2>&1 || true
    start ;;
  *) echo "usage: $0 {start|stop|status|url|logs|reset}" >&2; exit 2 ;;
esac
