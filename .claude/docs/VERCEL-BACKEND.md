# Vercel-native backend — target architecture for `packages/twenty-api`

Goal: host the **frontend and backend both on Vercel** by incrementally replacing the NestJS `twenty-server` with a Next.js backend, **without** giving up the ability to pull from upstream. The mechanism is a **strangler fig**: stand up `twenty-api`, proxy everything to legacy, then port routes one at a time until legacy is empty.

> This is a multi-month program. The `.claude/` config makes it **trackable and low-divergence** — it does not shrink it. `twenty-server` keeps running (Oracle/Hetzner per `HANDOFF.md`) as the proxy fallback throughout.

## Why NestJS can't just move to Vercel
`twenty-server` hard-depends on things Vercel serverless can't run: Redis (session/cache/pubsub/BullMQ), an **always-on worker** (`src/queue-worker/queue-worker.ts`), **22 cron jobs**, **GraphQL subscriptions** (graphql-ws / graphql-redis-subscriptions), and — the genuine hard core — **per-workspace dynamic Postgres schemas** materialized from metadata by `src/engine/workspace-manager/workspace-migration/workspace-migration-runner/**`. Wrapping NestJS in a function would still need external Redis + a worker host, break subscriptions, and destroy upstream-pullability. So we re-implement, Vercel-native.

## Package shape
- `packages/twenty-api` — new Nx package, **its own Vercel project**, headless (route handlers only).
- Stack: **Next 16** (App Router), **React 19**, **Prisma 6**, **TS 5**, **yarn** (the monorepo is yarn-locked — never pnpm/npm here).
- Imports `twenty-shared` types. Carries AGPL-3.0 notices.

## The strangler facade
Frontend `REACT_APP_SERVER_BASE_URL` → `twenty-api` on Vercel. `twenty-api` serves ported routes natively and **proxies the rest to `LEGACY_SERVER_URL`** (the running `twenty-server`).

```
packages/twenty-api/app/
  healthz/route.ts            # first native handler
  graphql/route.ts            # MVP proxy → ${LEGACY_SERVER_URL}/graphql (native Yoga = later milestone)
  rest/[...path]/route.ts     # ported REST; unmatched → proxy to legacy
  api/inngest/route.ts        # Inngest serve() — background jobs + crons
  lib/ported-routes.ts        # registry: native vs proxied per path
  lib/proxy.ts                # fetch passthrough (headers, cookies, streaming)
  lib/prisma.ts               # Prisma client (Neon)
  lib/workspace.ts            # workspace schema resolution + search_path; tenant/auth guard
```
As a module ports over, flip its path in `ported-routes.ts` from proxy → native. Track every module in `MIGRATION-LEDGER.md`.

## Vercel-native replacement map
| twenty-server dependency | twenty-api replacement | notes |
| --- | --- | --- |
| Redis sessions | Upstash Redis, or stateless JWT (iron-session) | no in-process store on serverless |
| Redis cache | Upstash Redis | same client everywhere |
| Redis pub/sub | Upstash / Ably | only when subscriptions are ported |
| BullMQ worker (always-on) | **Inngest** (durable step functions) | one `api/inngest/route.ts`; free tier |
| 22 cron jobs | Inngest scheduled fns (preferred) or Vercel Cron | keeps background logic in one place |
| GraphQL Yoga server | Yoga **fetch handler in a route** | Yoga is fetch-native; do as a milestone |
| graphql-ws subscriptions | SSE/polling now; Ably/Pusher later | Vercel can't hold long-lived WS |
| TypeORM (core + metadata) | **Prisma 6** models | static tables map 1:1 |
| **per-workspace dynamic schemas** | Prisma static + ported migration-runner | the crux — see below |
| ClickHouse | external ClickHouse Cloud / Tinybird, or defer | not on the critical path |
| Postgres | **Neon** serverless | already linked |

## Per-workspace dynamic schema — the crux (do faithfully)
Twenty creates a real Postgres schema per workspace and materializes tables from metadata; Prisma has no runtime dynamic-schema generation. Faithful approach (a "refactor," not a re-architecture):
- **Prisma owns the static surface**: `core` + `metadata` tables — fully typed client.
- **Port the migration-runner**: re-express `workspace-migration-runner/**` as a module that emits raw DDL per workspace via `prisma.$executeRawUnsafe`, and reads/writes per-workspace object data via `$queryRawUnsafe` with the workspace schema set in `search_path`. This mirrors Twenty's own split (TypeORM core + bespoke runner), so future upstream runner changes stay portable.
- **Reject** the "single shared schema + `workspace_id` column" shortcut for anything that must track upstream (too divergent). Allowed only for genuinely new, non-upstream tables.

## Build slices (GraphQL-first sequencing matters)
The SPA is **GraphQL-first** (Apollo); REST is a thin minority. So REST-first native ports give almost no user-visible win until GraphQL is native. Sequence:
0. **Prove the facade** — `twenty-api` as a pure proxy; staging frontend points at it; nothing changes functionally. Validates Vercel + Nx build + Neon connectivity.
1. **First native, read-only** — `GET /healthz` + read one object (Company) via Prisma against materialized Neon workspace tables. Exercises Prisma + `search_path` + tenant/auth guard.
2. **Writes** for that object; then **auth** (token verify/refresh).
3. **metadata + migration-runner port** (dynamic schema creation) — the riskiest module.
4. **Inngest** jobs/crons; then **GraphQL** as a dedicated milestone (full cutover or a per-operation router that splits ported vs proxied ops — **never** a partial schema split, which breaks the SPA's generated types); **subscriptions last**.

`twenty-server` is **never deleted** — it's the reference and the fallback until legacy is empty.

## Validate every slice
`npx nx build twenty-api && npx nx typecheck twenty-api`, then exercise the route against a seeded Neon workspace and **diff the response vs legacy `twenty-server`** for the same request. Confirm the Vercel project root dir + `nx build twenty-api` works in Slice 0 before investing in ports.

## End state
Frontend (Vercel static) + `twenty-api` (Vercel) + Neon (Postgres) + Upstash (Redis) + Inngest (jobs/cron). The "$0 Vercel-only" goal arrives only after jobs + GraphQL are fully ported; until then the Oracle/Hetzner `twenty-server` stays up as the fallback.
