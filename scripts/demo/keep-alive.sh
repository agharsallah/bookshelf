#!/usr/bin/env bash
# Keep the free Render demo API awake (docs/DEMO.md): it sleeps after 15 minutes without a
# request. Run it from cron every 10 minutes on any always-on machine, e.g. the VM:
#
#   */10 * * * * /path/to/keep-alive.sh https://bookshelf-demo-api.onrender.com >/dev/null 2>&1
#
# A sleeping instance takes about a minute to wake, hence the long timeout. Exits non-zero
# when the API does not answer, so cron's mail (or `|| logger …`) can tell you.
set -euo pipefail

URL="${1:?usage: keep-alive.sh <api base url>}"
curl --silent --show-error --fail --max-time 120 --retry 2 --retry-delay 10 \
  --output /dev/null "${URL%/}/health"
