# Migration Ledger — NestJS `twenty-server` → Next.js `twenty-api`

Living board of the strangler-fig migration. Each backend module is **pending** (not started), **proxied** (facade passes it to legacy `twenty-server`), or **ported** (served natively by `twenty-api`). Update this in `/backend-port` and `/upstream-sync`.

Architecture + replacement map: `.claude/docs/VERCEL-BACKEND.md`. Sync workflow: `.claude/docs/UPSTREAM.md`.

## Status legend
- ⬜ **pending** — no work yet
- 🔁 **proxied** — facade forwards to `LEGACY_SERVER_URL`
- ✅ **ported** — native in `twenty-api`, route flipped on, validated vs legacy

## Phase 0 — facade scaffolding
| Item | Status | Notes |
| --- | --- | --- |
| `packages/twenty-api` Nx package (Next 16 + React 19) | ✅ | created 2026-06-27; registered in root workspaces; nx run-commands targets (build/dev/start/typecheck) |
| `lib/proxy.ts` + `lib/ported-routes.ts` (strangler facade) | ✅ | path-transparent fetch passthrough + native-route registry |
| `app/healthz/route.ts` (native) | ✅ | first native handler |
| `app/graphql/route.ts` (proxy → legacy) | 🔁 | proxied; keep whole until the GraphQL milestone |
| `app/[...slug]/route.ts` catch-all (proxy → legacy) | 🔁 | covers /metadata, /rest/*, /files, /auth/*, … verbatim |
| `nx build twenty-api` green | ⬜ | building/validating now |
| Vercel project (root dir = packages/twenty-api) | ⬜ | set LEGACY_SERVER_URL; point frontend at it |
| Neon connectivity from `twenty-api` | ⬜ | Slice 1+ (Prisma); DB already linked |

## Core surface
| Module | Status | Notes |
| --- | --- | --- |
| `healthz` | ⬜ | Slice 1, first native handler |
| Prisma schema: `core` tables | ⬜ | users, workspaces, … |
| Prisma schema: `metadata` tables | ⬜ | objectMetadata, fieldMetadata, … |
| Auth / sessions | ⬜ | Upstash or iron-session JWT |
| `workspace-migration-runner` (per-workspace DDL) | ⬜ | **the crux** — Slice 3 |
| Tenant guard (`search_path` + workspace scope) | ⬜ | reused by every route |

## Feature modules (fill in from the upstream-scout worklist)
| Module | Status | Upstream range | Notes |
| --- | --- | --- | --- |
| GraphQL layer (Yoga in route) | ⬜ | | dedicated milestone; no partial schema split |
| Standard objects CRUD (Company first) | ⬜ | | Slice 1–2 |
| Messaging import | ⬜ | | Inngest job |
| Calendar import | ⬜ | | Inngest job |
| Workflow engine | ⬜ | | Inngest |
| Billing | ⬜ | | |
| GraphQL subscriptions | ⬜ | | last; SSE/polling or Ably |
| Cron jobs (22) → Inngest scheduled fns | ⬜ | | |
| ClickHouse analytics | ⬜ | | external or defer |

> When the upstream-scout produces a backend port worklist, add/refresh rows here so the ledger always reflects what's left.
