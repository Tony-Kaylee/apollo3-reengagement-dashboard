#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATE_SCRIPT="${REPO_DIR}/scripts/update_dashboard.sh"
JOB_NAME="Apollo 3 Re-engagement Dashboard Update"

chmod +x "$UPDATE_SCRIPT"

existing_id="$(
  openclaw cron list --json \
    | python3 -c 'import json,sys; data=json.load(sys.stdin); name=sys.argv[1]; print(next((j["id"] for j in data.get("jobs", []) if j.get("name") == name), ""))' "$JOB_NAME"
)"

if [[ -n "$existing_id" ]]; then
  openclaw cron rm "$existing_id"
fi

openclaw cron add \
  --agent main \
  --name "$JOB_NAME" \
  --description "Refresh and publish the Apollo 3 re-engagement dashboard from its configured data source." \
  --cron "0 9 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --no-deliver \
  --tools exec \
  --timeout-seconds 300 \
  --message "Run ${UPDATE_SCRIPT}. If it exits non-zero, inspect ${REPO_DIR}/logs/dashboard-update.log and report the blocker privately; do not post to Discord unless explicitly asked."

echo "Installed OpenClaw cron job: ${JOB_NAME}"
echo "Schedule: 9:00 AM America/New_York daily"
