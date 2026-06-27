---
name: vercel-backend
description: Conventions and scaffolding for packages/twenty-api — the Vercel-native Next.js backend that incrementally replaces twenty-server (NestJS). Covers the strangler-fig facade, GraphQL Yoga in a route handler, Prisma 6 + per-workspace schema strategy, and the Upstash/Inngest/Neon replacement map. Use when creating or extending twenty-api, scaffolding the proxy facade, or deciding how a backend feature should run on Vercel.
---

# /vercel-backend — building packages/twenty-api

Target: host frontend AND backend on Vercel by re-implementing the NestJS backend as a Next.js 16 (App Router) headless app. Full architecture + rationale in `.claude/docs/VERCEL-BACKEND.md`. This skill is the hands-on conventions layer.

## Package shape
- `packages/twenty-api` — new Nx package, **own Vercel project**, imports `twenty-shared` types.
- Stack: Next 16 (route handlers only, no UI), React 19, **Prisma 6**, TS 5, **yarn** (monorepo is yarn-locked — never introduce pnpm/npm here).
- Carry AGPL-3.0 notices.

## Strangler facade (this is how we coexist with legacy)
The frontend's `REACT_APP_SERVER_BASE_URL` points at `twenty-api` on Vercel. `twenty-api` serves ported routes natively and **proxies everything else to `LEGACY_SERVER_URL`** (the existing `twenty-server` on the Oracle/Hetzner kit). A `ported-routes` registry decides native-vs-proxy per path.

```
packages/twenty-api/app/
  healthz/route.ts            # first native handler
  graphql/route.ts            # MVP: proxy → ${LEGACY_SERVER_URL}/graphql (Yoga handler later, as a milestone)
  rest/[...path]/route.ts     # ported REST handlers; unmatched → proxy to legacy
  api/inngest/route.ts        # Inngest serve() — background jobs + crons
  lib/ported-routes.ts        # registry: which paths are native vs proxied
  lib/proxy.ts                # fetch-passthrough to LEGACY_SERVER_URL (headers, cookies, streaming)
  lib/prisma.ts               # Prisma client (Neon)
  lib/workspace.ts            # resolve workspace schema + set search_path; tenant/auth guard
```

## Vercel-native replacement map (one per blocker)
| twenty-server dependency | twenty-api replacement |
| --- | --- |
| Redis sessions | Upstash Redis, or stateless JWT via iron-session |
| Redis cache / pubsub | Upstash Redis (pubsub only when subscriptions are ported) |
| BullMQ always-on worker | Inngest (durable, event-driven step functions) |
| 22 cron jobs | Inngest scheduled functions (preferred) or Vercel Cron in vercel.json |
| GraphQL Yoga server | yoga fetch handler inside app/graphql/route.ts (Yoga is fetch-native) — milestone, keep proxied first |
| graphql-ws subscriptions | SSE route / polling for MVP; Ably/Pusher later |
| TypeORM (core + metadata) | Prisma 6 models |
| per-workspace dynamic schemas | Prisma for static + ported workspace-migration-runner emitting raw DDL ($executeRawUnsafe) and per-workspace data ($queryRawUnsafe with search_path) |
| ClickHouse analytics | external ClickHouse Cloud / Tinybird over HTTP, or defer |
| Postgres | Neon serverless (already linked) |

## Per-workspace dynamic schema — the crux (do this faithfully)
- Prisma owns the **static** surface: `core` + `metadata` tables (users, workspaces, objectMetadata, fieldMetadata, …) — fully typed.
- Re-express `packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/**` as a module that emits raw DDL per workspace and reads/writes object data with the workspace schema in `search_path`. This mirrors Twenty's own split (TypeORM core + bespoke runner) so future upstream runner changes stay portable.
- Reject the "single shared schema + workspace_id column" shortcut for anything that must track upstream — it diverges too far. It's allowed only for genuinely new, non-upstream tables.

## Build slices (respect GraphQL-first sequencing)
0. Pure proxy facade — prove Vercel + Nx monorepo build + Neon connectivity; staging frontend points at it; **nothing changes functionally**.
1. Native `GET /healthz` + read one object (Company) via Prisma against materialized Neon workspace tables (exercises Prisma + search_path + tenant/auth guard).
2. Writes for that object; then auth (token verify/refresh).
3. metadata + migration-runner port (dynamic schema creation) — riskiest module.
4. Inngest jobs/crons; then GraphQL as a dedicated milestone (full or per-operation router — never a partial schema split); subscriptions last.

## Validate every slice
`npx nx build twenty-api && npx nx typecheck twenty-api`, then exercise the route against a seeded Neon workspace and diff the response vs legacy `twenty-server`. Confirm the Vercel project's root dir + `nx build twenty-api` works early (Slice 0) before investing in ports.
