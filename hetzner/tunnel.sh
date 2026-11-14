#!/usr/bin/env bash
# The Mac <-> Hetzner CRM tunnel (launchd: com.databayt.twenty-tunnel).
#
#   -L 3100  Mac localhost:3100 -> the CRM API on the server. ~194 scripts default
#            TWENTY_API_URL to http://localhost:3100; they keep working unchanged.
#   -R 8644  server :8644 -> Hermes on this Mac. The ACTIVE Hogwarts workflow
#            "School shortlisted → outreach" POSTs host.docker.internal:8644 from the worker.
#            The Hetzner firewall keeps 8644 closed to the internet.
#
# The public API (the SPA, webhooks) is https://crm-api.databayt.org and needs no tunnel.
#
#   hetzner/tunnel.sh --install | --uninstall | --status
set -euo pipefail
LABEL=com.databayt.twenty-tunnel
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HOST=${TWENTY_HOST:-2.31.202.201}
KEY="$HOME/.ssh/hetzner_twenty"
LOG="$HOME/Library/Logs/twenty-tunnel.log"

case "${1:---status}" in
  --install)
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/ssh</string><string>-N</string><string>-T</string>
    <string>-i</string><string>$KEY</string>
    <string>-o</string><string>ExitOnForwardFailure=yes</string>
    <string>-o</string><string>ServerAliveInterval=30</string>
    <string>-o</string><string>ServerAliveCountMax=3</string>
    <string>-o</string><string>StrictHostKeyChecking=yes</string>
    <string>-L</string><string>127.0.0.1:3100:127.0.0.1:3100</string>
    <string>-R</string><string>0.0.0.0:8644:127.0.0.1:8644</string>
    <string>root@$HOST</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed $LABEL" ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "removed $LABEL" ;;
  --status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E '^\s+(state|pid) =' || echo "not loaded"
    curl -fsS -m 5 http://127.0.0.1:3100/healthz && echo " (via tunnel)" ;;
esac
