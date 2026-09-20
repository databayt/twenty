#!/bin/bash
# Nightly backup of the self-hosted Twenty CRM.
#
# Twenty's backend runs in Docker on this Mac. Two things must be captured, and
# pg_dump alone captures only one of them:
#
#   1. Postgres  (twenty-db-1, database `default`)  — records, metadata, workflows
#   2. The `twenty_server-local-data` volume        — attachments. STORAGE_TYPE=local,
#      so uploads live on disk, NOT in Postgres. A pg_dump-only backup silently
#      loses every file anyone ever attached to a record.
#
# The CRM spent 2026-09-19 on Cloudflare (Neon + R2) and was moved back here the
# next day, so this script briefly dumped Neon instead. If it ever moves off the
# Mac again, the Neon/R2 variant is in commit 83bb510881 — and note that Neon runs
# Postgres 17, which the v16 pg_dump on PATH refuses to dump from.
#
# Destination is Google Drive (private to the account) plus local retention.
# NOT the hogwarts-databayt S3 bucket: its bucket policy grants s3:GetObject to
# Principal "*", so every object in it is world-readable. A CRM dump there would
# publish every lead, contact and password hash to anyone who guesses the URL.
# Upgrading to a private bucket needs s3:CreateBucket, which the `hogwarts` IAM
# user does not have.
#
# Backups are NOT encrypted, deliberately. A passphrase held only in this Mac's
# Keychain would make the backups unreadable in the exact scenario they exist for
# — this Mac dying. Drive's own account isolation is the control.
#
#   backup-twenty.sh --run | --install | --uninstall | --status

set -u

DB_CONTAINER="twenty-db-1"
DB_NAME="default"
DB_USER="postgres"
VOLUME="twenty_server-local-data"

LOCAL_DIR="$HOME/backups/twenty"
DRIVE_DIR="$HOME/Library/CloudStorage/GoogleDrive-osmanabdout.jr@gmail.com/My Drive/databayt-backups/twenty"
RETAIN_LOCAL_DAYS=14
RETAIN_DRIVE_DAYS=30

PLIST_LABEL="com.databayt.twenty-backup"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
LOG_DIR="$HOME/.claude/logs"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

MODE="--run"
for arg in "$@"; do
    case "$arg" in
        --run|--install|--uninstall|--status) MODE="$arg" ;;
        *) echo "Unknown flag: $arg (use --run|--install|--uninstall|--status)" >&2; exit 1 ;;
    esac
done

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/twenty-backup-$(date +%F).log"
log() { echo "[$(date '+%F %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# ── Scheduler ────────────────────────────────────────────────────

render_plist() {
    cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$PLIST_LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$SCRIPT_PATH</string>
		<string>--run</string>
	</array>
	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key>
		<integer>3</integer>
		<key>Minute</key>
		<integer>30</integer>
	</dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
	</dict>
	<key>StandardOutPath</key>
	<string>$LOG_DIR/twenty-backup-launchd.out</string>
	<key>StandardErrorPath</key>
	<string>$LOG_DIR/twenty-backup-launchd.err</string>
</dict>
</plist>
PLIST
}

case "$MODE" in
--install)
    mkdir -p "$HOME/Library/LaunchAgents"
    render_plist > "$PLIST_PATH"
    launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH" 2>/dev/null || true
    echo "armed: $PLIST_LABEL daily at 03:30 (plist: $PLIST_PATH)"
    exit 0 ;;
--uninstall)
    launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "disarmed: $PLIST_LABEL"
    exit 0 ;;
--status)
    launchctl list 2>/dev/null | grep -q "$PLIST_LABEL" && echo "launchd: armed" || echo "launchd: NOT armed"
    echo "local:  $(ls -1 "$LOCAL_DIR"/*.dump 2>/dev/null | wc -l | tr -d ' ') dumps in $LOCAL_DIR"
    [ -d "$DRIVE_DIR" ] && echo "drive:  $(ls -1 "$DRIVE_DIR"/*.dump 2>/dev/null | wc -l | tr -d ' ') dumps in Drive" || echo "drive:  directory not reachable"
    ls -lht "$LOCAL_DIR" 2>/dev/null | head -6
    exit 0 ;;
esac

# ── Run ──────────────────────────────────────────────────────────

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOCAL_DIR"

if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
    log "FAIL: container $DB_CONTAINER not found — is the stack up? (cd packages/twenty-docker && docker compose up -d)"
    exit 1
fi

# 1. Postgres. -Fc is the custom format: compressed, and pg_restore can pick
#    individual tables out of it, which a plain SQL dump cannot.
DUMP="$LOCAL_DIR/twenty-$STAMP.dump"
log "dumping $DB_NAME …"
if ! docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$DUMP" 2>>"$LOG_FILE"; then
    log "FAIL: pg_dump errored"
    rm -f "$DUMP"
    exit 1
fi
# A dump that exists but is truncated is worse than no dump — it looks like success.
if [ ! -s "$DUMP" ] || [ "$(stat -f%z "$DUMP")" -lt 10000 ]; then
    log "FAIL: dump is suspiciously small ($(stat -f%z "$DUMP" 2>/dev/null || echo 0) bytes)"
    rm -f "$DUMP"
    exit 1
fi
log "  → $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1))"

# 2. Attachments. The volume lives inside the Colima VM, not on the macOS
#    filesystem, so it is read through a throwaway container rather than directly.
FILES="$LOCAL_DIR/twenty-files-$STAMP.tar.gz"
log "archiving volume $VOLUME …"
if docker run --rm -v "$VOLUME":/data:ro alpine tar -czf - -C /data . > "$FILES" 2>>"$LOG_FILE"; then
    log "  → $(basename "$FILES") ($(du -h "$FILES" | cut -f1))"
else
    log "WARN: volume archive failed — Postgres dump still succeeded"
    rm -f "$FILES"
fi

# 3. Off-machine copy.
if mkdir -p "$DRIVE_DIR" 2>/dev/null; then
    cp "$DUMP" "$DRIVE_DIR/" 2>>"$LOG_FILE" && log "drive: dump copied"
    [ -f "$FILES" ] && cp "$FILES" "$DRIVE_DIR/" 2>>"$LOG_FILE" && log "drive: files copied"
    find "$DRIVE_DIR" -name 'twenty-*' -mtime +$RETAIN_DRIVE_DAYS -delete 2>/dev/null
else
    log "WARN: Drive not reachable — this backup is LOCAL ONLY"
fi

find "$LOCAL_DIR" -name 'twenty-*' -mtime +$RETAIN_LOCAL_DAYS -delete 2>/dev/null
log "done — $(ls -1 "$LOCAL_DIR"/*.dump 2>/dev/null | wc -l | tr -d ' ') local dumps retained"
