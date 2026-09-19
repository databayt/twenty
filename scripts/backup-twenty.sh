#!/bin/bash
# Nightly backup of the Twenty CRM.
#
# The CRM moved off this Mac on 2026-09-19: the server runs in a Cloudflare
# Container, Postgres is on Neon and attachments are in Cloudflare R2. This script
# no longer touches Docker at all — it used to dump `twenty-db-1` and tar the
# `twenty_server-local-data` volume, and both of those are gone.
#
# Two things must still be captured, and pg_dump alone captures only one:
#
#   1. Postgres  (Neon project `twenty`, database `neondb`) — records, metadata,
#      workflows. Dumped over the DIRECT (non-pooled) endpoint: pgbouncer breaks
#      the session-level things pg_dump relies on.
#   2. The R2 bucket `twenty-crm-storage` — attachments. STORAGE_TYPE=s3, so
#      uploads live in object storage, NOT in Postgres. A pg_dump-only backup
#      silently loses every file anyone ever attached to a record.
#
# Neon keeps its own history, but that is a 6-hour retention window on the free
# plan and it dies with the Neon project. This is the copy that survives the
# account.
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

# Neon connection string lives in the Keychain, never on disk. DIRECT, not pooled.
DB_KEYCHAIN_SERVICE="cf-twenty-PG_DIRECT"
R2_BUCKET="twenty-crm-storage"
R2_ENDPOINT="https://ce9a5376d149c808a0b97072421ba12f.r2.cloudflarestorage.com"
R2_KEY_SERVICE="cf-twenty-R2_ACCESS_KEY_ID"
R2_SECRET_SERVICE="cf-twenty-R2_SECRET_ACCESS_KEY"

# Neon runs Postgres 17 and pg_dump REFUSES to dump from a server newer than
# itself ("aborting because of server version mismatch"), so the v16 client on
# PATH is not usable here. Pin the v17 binary and fail loudly if it is missing
# rather than silently producing nothing.
PG_DUMP="${PG_DUMP:-/opt/homebrew/opt/postgresql@17/bin/pg_dump}"

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

if [ ! -x "$PG_DUMP" ]; then
    log "FAIL: no Postgres 17 pg_dump at $PG_DUMP — install it (brew install postgresql@17)."
    log "      The v16 client on PATH cannot dump Neon's v17 server."
    exit 1
fi

# Credentials come from the login Keychain. Under launchd this works while the
# user session is unlocked; if the Mac is locked at 03:30 `security` returns
# empty and we must fail rather than write a 0-byte "backup".
DB_URL="$(security find-generic-password -a "$USER" -s "$DB_KEYCHAIN_SERVICE" -w 2>/dev/null)"
if [ -z "${DB_URL:-}" ]; then
    log "FAIL: could not read $DB_KEYCHAIN_SERVICE from the Keychain (is the session locked?)"
    exit 1
fi

# 1. Postgres. -Fc is the custom format: compressed, and pg_restore can pick
#    individual tables out of it, which a plain SQL dump cannot. --no-owner and
#    --no-privileges keep the dump restorable onto a role that is not Neon's
#    neondb_owner.
DUMP="$LOCAL_DIR/twenty-$STAMP.dump"
log "dumping Neon ($(echo "$DB_URL" | sed -E 's#.*@([^/?]+).*#\1#')) …"
if ! "$PG_DUMP" -Fc --no-owner --no-privileges -d "$DB_URL" > "$DUMP" 2>>"$LOG_FILE"; then
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

# 2. Attachments, mirrored out of R2. Keys are preserved so the tarball can be
#    synced straight back into a bucket — Twenty stores the key, not a URL.
FILES="$LOCAL_DIR/twenty-files-$STAMP.tar.gz"
R2_KEY="$(security find-generic-password -a "$USER" -s "$R2_KEY_SERVICE" -w 2>/dev/null)"
R2_SECRET="$(security find-generic-password -a "$USER" -s "$R2_SECRET_SERVICE" -w 2>/dev/null)"
if [ -z "${R2_KEY:-}" ] || [ -z "${R2_SECRET:-}" ]; then
    log "WARN: R2 credentials unavailable — Postgres dump succeeded, attachments NOT captured"
elif ! command -v aws >/dev/null 2>&1; then
    log "WARN: aws CLI not found — Postgres dump succeeded, attachments NOT captured"
else
    STAGE="$(mktemp -d "${TMPDIR:-/tmp}/twenty-r2.XXXXXX")"
    log "syncing r2://$R2_BUCKET …"
    if AWS_ACCESS_KEY_ID="$R2_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET" AWS_DEFAULT_REGION=auto \
       aws s3 sync "s3://$R2_BUCKET" "$STAGE" --endpoint-url "$R2_ENDPOINT" --only-show-errors >>"$LOG_FILE" 2>&1; then
        COUNT=$(find "$STAGE" -type f | wc -l | tr -d ' ')
        if [ "$COUNT" -eq 0 ]; then
            log "WARN: R2 sync returned 0 objects — not writing an empty archive"
        elif tar -czf "$FILES" -C "$STAGE" . 2>>"$LOG_FILE"; then
            log "  → $(basename "$FILES") ($(du -h "$FILES" | cut -f1), $COUNT objects)"
        else
            log "WARN: archiving the R2 mirror failed — Postgres dump still succeeded"
            rm -f "$FILES"
        fi
    else
        log "WARN: R2 sync failed — Postgres dump still succeeded"
    fi
    rm -rf "$STAGE"
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
