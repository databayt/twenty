#!/usr/bin/env bash
# Deploy the Twenty SPA to Cloudflare from the SAME image the API runs.
#
# Why this exists: the Worker's assets must be the frontend built from the exact version
# of the server answering its queries. Building this fork's twenty-front and deploying
# that is what broke every workspace on 2026-09-20 — the fork's base is older than the
# published image, so the SPA asked for `Application.logo`, which upstream had replaced
# with `logoFileId`. Symptom is nasty: the password is ACCEPTED, tokens are issued, then
# GetCurrentUser 400s with `Cannot query field "..."` and the user is bounced back to the
# sign-in modal looking exactly like a wrong password.
#
# The image already ships a matched build at dist/front, so there is nothing to compile.
#
#   ./scripts/deploy-front-from-image.sh [api-url]
#
# Known cost: the stock build restores upstream's 8-char minimum password on the SIGN-IN
# form (this fork relaxed it to 4 in 424b37e3e2). Accounts with shorter passwords cannot
# sign in until their password is reset to 8+.
#
# Prerequisite: AUTH_COOKIE_ALLOWED_ORIGINS must list every workspace origin (see
# packages/twenty-docker/docker-compose.override.yml). Since v2.31.x the front sends
# credentialed requests, and the server answers an unlisted origin with
# Access-Control-Allow-Origin: *, which a browser rejects for credentialed requests --
# the /metadata preflight fails and the sign-in form never renders at all. Checked below.
set -euo pipefail
cd "$(dirname "$0")/.."

API_URL="${1:-https://twenty-api-2.tail42a5c4.ts.net}"
CONTAINER="${CONTAINER:-twenty-server-1}"
STAGE=$(mktemp -d -t twenty-front.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT

docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || {
  echo "container '$CONTAINER' is not running — start the stack first"; exit 1; }

# A deploy that lands on a server without the allow-list looks like a much worse bug than
# it is, so refuse rather than ship it.
docker exec "$CONTAINER" sh -lc 'env | grep -qE "^AUTH_COOKIE_ALLOWED_ORIGINS=.+"' || {
  echo "AUTH_COOKIE_ALLOWED_ORIGINS is empty on $CONTAINER — the SPA's credentialed"
  echo "requests would be blocked by the browser. Set it in packages/twenty-docker/.env"
  echo "and recreate the server before deploying."; exit 1; }

IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")
echo "==> source image: $IMAGE"

echo "==> backing up the build that is live now"
[ -d packages/twenty-front/build ] && \
  cp -R packages/twenty-front/build "$HOME/backups/twenty-front-build-$(date +%Y%m%d-%H%M%S)"

echo "==> extracting the matched frontend from the image"
docker cp "$CONTAINER:/app/packages/twenty-server/dist/front/." "$STAGE/"

echo "==> injecting REACT_APP_SERVER_BASE_URL=$API_URL"
# The image serves the SPA same-origin, so it ships `window._env_ = {}`. On Cloudflare the
# API is cross-origin (a Worker cannot TLS-handshake a Tailscale Funnel — see cf/worker.js),
# so the URL has to be baked in here.
API_URL="$API_URL" python3 - "$STAGE/index.html" <<'PY'
import os, sys
p = sys.argv[1]
s = open(p).read()
old = 'window._env_ = {};'
if old not in s:
    sys.exit("index.html has no `window._env_ = {};` placeholder — image layout changed")
new = 'window._env_ = {\n  "REACT_APP_SERVER_BASE_URL": "%s"\n};' % os.environ['API_URL']
open(p, 'w').write(s.replace(old, new, 1))
print("    injected")
PY

echo "==> swapping the build and deploying"
rsync -a --delete "$STAGE/" packages/twenty-front/build/
npx wrangler deploy

ENTRY=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' packages/twenty-front/build/index.html | head -1)
echo
echo "==> deployed entry bundle: $ENTRY"
echo "==> verifying every workspace host serves it"
FAIL=0
for h in hogwarts mkan sijillee moallimee sales app; do
  GOT=$(curl -sS -H 'Cache-Control: no-cache' "https://$h.databayt.org/welcome" \
        | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
  if [ "$GOT" = "$ENTRY" ]; then printf '    ok   %-12s %s\n' "$h" "$GOT"
  else printf '    WAIT %-12s %s (edge cache; re-check)\n' "$h" "${GOT:-<none>}"; FAIL=1; fi
done
exit $FAIL
