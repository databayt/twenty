#!/usr/bin/env bash
# SessionStart hook: nudge when the fork has drifted from twentyhq/twenty.
# Read-only and offline-safe — the actual `git fetch` happens inside /upstream-sync.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "${root:-}" ] || exit 0
cd "$root" 2>/dev/null || exit 0

git remote get-url upstream >/dev/null 2>&1 || {
  echo "ℹ️  Twenty fork: no 'upstream' remote yet. Run /upstream-sync to start tracking twentyhq/twenty."
  exit 0
}
git rev-parse --verify --quiet upstream/main >/dev/null 2>&1 || {
  echo "ℹ️  Twenty fork: upstream remote set but not fetched yet. Run /upstream-sync."
  exit 0
}

last_sha="-"; last_date="-"
if [ -f ".claude/upstream-state.json" ]; then
  read -r last_sha last_date < <(node -e 'try{const fs=require("fs");const s=JSON.parse(fs.readFileSync(".claude/upstream-state.json","utf8"));process.stdout.write((s.lastSyncedUpstreamSha||"-")+" "+(s.lastSyncedDate||"-"))}catch(e){process.stdout.write("- -")}' 2>/dev/null)
fi

if [ -n "$last_sha" ] && [ "$last_sha" != "-" ]; then
  n=$(git rev-list --count "${last_sha}..upstream/main" 2>/dev/null || echo "?")
  if [ "$n" != "0" ] && [ "$n" != "?" ]; then
    echo "⬆️  Twenty upstream: $n new commit(s) on twentyhq/twenty since last sync (${last_date}). Run /upstream-sync to pull frontend + queue backend ports."
  fi
else
  echo "⬆️  Twenty upstream: tracked but never synced. Run /upstream-sync to pull the latest from twentyhq/twenty."
fi
exit 0
