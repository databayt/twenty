#!/usr/bin/env bash
# One-command deploy for the single-host (Oracle Always Free) Twenty stack.
#
#   ./oracle-deploy.sh
#
# - creates .env from .env.oracle.example on first run
# - auto-generates the DB password and app secrets if they're blank
# - validates DOMAIN / ACME_EMAIL are set
# - brings up server + worker + Postgres + Redis + Caddy (auto-HTTPS)
#
# Re-run any time to apply changes or pull a new image (idempotent).

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="docker-compose.oracle.yml"
ENV_FILE=".env"
EXAMPLE_FILE=".env.oracle.example"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mxx \033[0m %s\n' "$*" >&2; exit 1; }

# ── prerequisites ─────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "docker is not installed. See ORACLE_FREE_DEPLOY.md > 'Install Docker'."
docker compose version >/dev/null 2>&1 || die "docker compose v2 plugin missing. See ORACLE_FREE_DEPLOY.md."
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets."

# ── .env bootstrap ────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  log "Creating $ENV_FILE from $EXAMPLE_FILE"
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  warn "Edit $ENV_FILE and set DOMAIN and ACME_EMAIL, then re-run this script."
fi

# Replace `KEY=` (empty value) with a generated secret. Leaves set values alone.
gen_if_blank() {
  local key="$1" value="$2"
  if grep -qE "^${key}=$" "$ENV_FILE"; then
    # portable in-place edit (GNU + BSD sed)
    sed -i.bak "s|^${key}=$|${key}=${value}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
    log "Generated ${key}"
  fi
}

gen_if_blank "PG_DATABASE_PASSWORD" "$(openssl rand -hex 24)"
gen_if_blank "ENCRYPTION_KEY"       "$(openssl rand -base64 32)"
gen_if_blank "APP_SECRET"           "$(openssl rand -base64 32)"

# ── validate required values ──────────────────────────────────────────────
# Parse only the keys we need — do NOT `source` .env (a secret containing shell
# metacharacters like $, backtick or spaces would corrupt or execute).
get_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
DOMAIN="$(get_env DOMAIN)"
ACME_EMAIL="$(get_env ACME_EMAIL)"

[ "$DOMAIN" = "crm.databayt.org" ] && warn "DOMAIN is still the default (crm.databayt.org) — change it if that's not yours."
[ -z "$DOMAIN" ] && die "DOMAIN is empty in $ENV_FILE."
case "$ACME_EMAIL" in
  ""|"you@example.com") die "Set a real ACME_EMAIL in $ENV_FILE (Let's Encrypt needs it).";;
esac

# ── deploy ────────────────────────────────────────────────────────────────
log "Pulling images (server/worker/postgres/redis/caddy)…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull --quiet || true

log "Starting the stack…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

log "Waiting for the server to become healthy (first boot runs DB migrations)…"
status=""
for _ in $(seq 1 60); do
  cid="$(docker compose -f "$COMPOSE_FILE" ps -q server 2>/dev/null || true)"
  status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  sleep 5
done

echo
docker compose -f "$COMPOSE_FILE" ps
echo
if [ "${status:-}" = "healthy" ]; then
  log "Up. Open: https://${DOMAIN}  (first HTTPS handshake provisions the cert; give it ~30s)"
else
  warn "Server not healthy yet. Check logs:"
  echo "    docker compose -f $COMPOSE_FILE logs -f server"
fi
