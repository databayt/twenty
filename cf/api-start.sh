#!/bin/sh
# Cloudflare Container entrypoint for the Twenty backend.
#
# Postgres moved to Neon and attachments to R2, so this container runs the two stateless Node
# processes plus a local Redis. Redis is deliberately ephemeral: Twenty re-registers its
# cron/repeatable jobs on boot (see below), so a restart loses only in-flight jobs — and with
# max_instances 1 the only restarts are deploys. That keeps the queue free rather than on a
# paid Upstash plan.
#
# ORDER MATTERS. The stock entrypoint.sh runs cache:flush -> upgrade -> cron:register BEFORE
# exec'ing the server, which takes minutes; Cloudflare gives up waiting for something to
# listen on :3000 and the deploy fails with "container is not listening in the TCP address".
# So the server starts FIRST with migrations and cron registration disabled, and the cron
# registration runs afterwards, once the port is open. Schema migrations are NOT run here at
# all: they were applied to Neon during the migration and re-running them on every cold start
# is the wrong place for them. A Twenty version bump needs a deliberate one-off
# `yarn command:prod upgrade` against Neon before deploying the new image.
set -e

echo "==> redis (ephemeral, loopback only)"
redis-server --save '' --appendonly no --daemonize yes --bind 127.0.0.1 --port 6379
i=0
while ! redis-cli ping >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 30 ] && { echo "ABORT: redis did not come up"; exit 1; }
  sleep 1
done
echo "    redis up after ${i}s"

cd /app/packages/twenty-server

echo "==> server (migrations + cron registration deferred so :3000 opens immediately)"
DISABLE_DB_MIGRATIONS=true DISABLE_CRON_JOBS_REGISTRATION=true /app/entrypoint.sh node dist/main &
SERVER=$!

# Once the port answers, register the cron/repeatable jobs into this container's fresh Redis.
(
  j=0
  while ! curl -sf -o /dev/null "http://127.0.0.1:${NODE_PORT:-3000}/healthz" 2>/dev/null; do
    j=$((j+1)); [ "$j" -gt 300 ] && { echo "WARN: server never became healthy; skipping cron registration"; exit 0; }
    sleep 2
  done
  echo "    server healthy after ${j}x2s — registering cron jobs"
  yarn command:prod cron:register:all || echo "WARN: cron registration failed; jobs will not fire until the next restart"
) &

echo "==> worker"
DISABLE_DB_MIGRATIONS=true DISABLE_CRON_JOBS_REGISTRATION=true yarn worker:prod &
WORKER=$!

# If either long-lived process dies the container is unhealthy — exit so Cloudflare restarts it
# rather than leaving a half-dead instance serving traffic.
while kill -0 "$SERVER" 2>/dev/null && kill -0 "$WORKER" 2>/dev/null; do sleep 5; done
echo "ABORT: server or worker exited; bringing the container down"
kill "$SERVER" "$WORKER" 2>/dev/null || true
exit 1
