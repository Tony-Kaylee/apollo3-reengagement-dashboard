#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${REPO_DIR}/logs"
LOG_FILE="${LOG_DIR}/dashboard-update.log"
LOCK_FILE="/tmp/apollo3-reengagement-dashboard-update.lock"

mkdir -p "$LOG_DIR"

exec >>"$LOG_FILE" 2>&1

echo "[$(date -Is)] Starting Apollo 3 re-engagement dashboard update"

(
  flock -n 9 || {
    echo "[$(date -Is)] Another update is already running; exiting"
    exit 0
  }

  cd "$REPO_DIR"

  git fetch origin main
  git pull --ff-only origin main

  if [[ -n "${APOLLO3_DASHBOARD_REFRESH_COMMAND:-}" ]]; then
    echo "[$(date -Is)] Running APOLLO3_DASHBOARD_REFRESH_COMMAND"
    bash -lc "$APOLLO3_DASHBOARD_REFRESH_COMMAND"
  elif [[ -x "./scripts/rebuild_dashboard.py" ]]; then
    echo "[$(date -Is)] Running scripts/rebuild_dashboard.py"
    ./scripts/rebuild_dashboard.py
  elif [[ -x "./scripts/rebuild_dashboard.sh" ]]; then
    echo "[$(date -Is)] Running scripts/rebuild_dashboard.sh"
    ./scripts/rebuild_dashboard.sh
  else
    echo "[$(date -Is)] No refresh command found."
    echo "Set APOLLO3_DASHBOARD_REFRESH_COMMAND or add scripts/rebuild_dashboard.py."
    exit 2
  fi

  if git diff --quiet -- index.html; then
    echo "[$(date -Is)] No dashboard changes to publish"
    exit 0
  fi

  git add index.html
  git commit -m "Update Apollo 3 re-engagement dashboard"
  git push origin main

  echo "[$(date -Is)] Dashboard update published"
) 9>"$LOCK_FILE"

