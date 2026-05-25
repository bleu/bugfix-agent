#!/usr/bin/env bash
# Poll AppSignal for new incidents whose first_seen_at >= deploy_time.
# Emits the first matching incident's JSON to stdout and exits 0.
# Exits 1 if no incident found before the window expires.
#
# Required env: APPSIGNAL_APP_ID, APPSIGNAL_PERSONAL_TOKEN, DEPLOY_TIME (ISO8601)
# Optional env: DEPLOY_SHA, WINDOW_MINUTES (default 30), POLL_INTERVAL_SEC (default 120)
set -euo pipefail

: "${APPSIGNAL_APP_ID:?missing}"
: "${APPSIGNAL_PERSONAL_TOKEN:?missing}"
: "${DEPLOY_TIME:?missing}"

WINDOW_MINUTES="${WINDOW_MINUTES:-30}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-120}"
DEPLOY_SHA="${DEPLOY_SHA:-}"

end_ts=$(( $(date +%s) + WINDOW_MINUTES * 60 ))

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while :; do
  now=$(date +%s)
  if (( now >= end_ts )); then
    echo "watch-poll: window expired with no new incidents" >&2
    exit 1
  fi

  output="$(npx --yes tsx "$script_dir/appsignal.ts" since "$DEPLOY_TIME" "$DEPLOY_SHA" 2>/dev/null || echo '[]')"
  first="$(echo "$output" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d||"[]");process.stdout.write(a[0]?JSON.stringify(a[0]):"")})')"

  if [[ -n "$first" ]]; then
    echo "$first"
    exit 0
  fi

  sleep "$POLL_INTERVAL_SEC"
done
