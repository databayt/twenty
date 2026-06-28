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
| `nx build twenty-api` green | ✅ | builds + typechecks (Next 16.2.9, Prisma 6.19.3) |
| Vercel project (root dir = packages/twenty-api) | ⬜ | set LEGACY_SERVER_URL + DATABASE_URL; point frontend at it |
| DB connectivity from `twenty-api` (Prisma) | ✅ | Slice 1 verified against the live dev DB (Neon ready) |

## Core surface
| Module | Status | Notes |
| --- | --- | --- |
| `healthz` | ✅ | native handler |
| Prisma schema: `core` tables | 🔁 | partial: `Workspace`, `SigningKey`, `ApiKey`, `UserWorkspace`, `ObjectMetadata`, `FieldMetadata`, `Application` (Slices 1–3); add models as ports need them |
| Metadata (objectMetadata/fieldMetadata) | 🔁 | NB: live in the `core` schema in this build (no separate `metadata` schema). Partial models added Slice 3 |
| Auth / token verification | ✅ | Slice 2: `app/lib/{jwt,signing-key,auth}.ts` — faithful dual-algo verify (ES256 via core.signingKey kid / HS256 APP_SECRET-derived legacy), membership check, API-key revoke/expiry recheck. **Gap:** role/object permissions NOT yet enforced (any valid workspace token can read+write) — before broad rollout |
| `workspace-migration-runner` (per-workspace DDL) | 🔁 | **the crux** — Slice 3 FIRST INCREMENT done: `app/lib/metadata/*` + `POST /rest/metadata/fields` create one TEXT scalar field atomically (fieldMetadata insert + `ALTER TABLE ADD COLUMN` + metadataVersion bump in one tx). Live-verified vs Hogwarts then cleaned net-zero. **Deferred:** composite/relation/enum/tsvector types, object creation, the computed-diff/flat-entity engine, indexes, GraphQL/metadata cache rebuild, down-migrations |
| Tenant spine (`search_path` per-workspace read+write) | ✅ | `app/lib/workspace.ts`: resolve schema (by subdomain or id) + raw read/insert w/ injection guard (Slices 1–2) |

## Feature modules (fill in from the upstream-scout worklist)
| Module | Status | Upstream range | Notes |
| --- | --- | --- | --- |
| GraphQL layer (Yoga in route) | ⬜ | | dedicated milestone; no partial schema split |
| Standard objects CRUD (Company first) | ✅ | | Slice 2: authenticated native `GET` + `POST /rest/companies` (live-verified: 3 companies read, create persisted, negatives 401). Remaining: GET single/:id, PATCH/DELETE, batch, filter/order/depth — still proxied to legacy via the catch-all |
| Messaging import | ⬜ | | Inngest job |
| Calendar import | ⬜ | | Inngest job |
| Workflow engine | ⬜ | | Inngest |
| Billing | ⬜ | | |
| GraphQL subscriptions | ⬜ | | last; SSE/polling or Ably |
| Cron jobs (22) → Inngest scheduled fns | ⬜ | | |
| ClickHouse analytics | ⬜ | | external or defer |

> When the upstream-scout produces a backend port worklist, add/refresh rows here so the ledger always reflects what's left.
