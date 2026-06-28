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
| Prisma schema: `core` tables | 🔁 | partial: `Workspace`, `SigningKey`, `ApiKey`, `UserWorkspace`, `ObjectMetadata`, `FieldMetadata`, `Application`, `Role`, `RoleTarget`, `ObjectPermission` (Slices 1–6); add models as ports need them |
| Metadata (objectMetadata/fieldMetadata) | 🔁 | NB: live in the `core` schema in this build (no separate `metadata` schema). Partial models added Slice 3 |
| Auth / token verification | ✅ | Slice 2: `app/lib/{jwt,signing-key,auth}.ts` — faithful dual-algo verify (ES256 via core.signingKey kid / HS256 APP_SECRET-derived legacy), membership check, API-key revoke/expiry recheck |
| Role / object permissions | ✅ | Slice 6: `app/lib/permissions.ts` `assertObjectPermission`/`assertSettingsPermission` — principal→roleTarget→role; `override ?? roleDefault`; op→flag (create=canUpdate); system-object bypass. Enforced on rest/companies GET+POST, graphql-native, rest/metadata/fields (settings). Live-verified allow+deny+override, net-zero. **Deferred:** field-level/restricted-fields, settings-flag granularity, row-level/record-sharing, multi-role intersection |
| `workspace-migration-runner` (per-workspace DDL) | 🔁 | **the crux** — Slice 3 FIRST INCREMENT done: `app/lib/metadata/*` + `POST /rest/metadata/fields` create one TEXT scalar field atomically (fieldMetadata insert + `ALTER TABLE ADD COLUMN` + metadataVersion bump in one tx). Live-verified vs Hogwarts then cleaned net-zero. **Deferred:** composite/relation/enum/tsvector types, object creation, the computed-diff/flat-entity engine, indexes, GraphQL/metadata cache rebuild, down-migrations |
| Tenant spine (`search_path` per-workspace read+write) | ✅ | `app/lib/workspace.ts`: resolve schema (by subdomain or id) + raw read/insert w/ injection guard (Slices 1–2) |

## Feature modules (fill in from the upstream-scout worklist)
| Module | Status | Upstream range | Notes |
| --- | --- | --- | --- |
| GraphQL layer (Yoga in route) | 🔁 | | Slices 5 + 10: native `graphql-yoga` at **`/graphql-native`** (real `/graphql` stays PROXIED — no partial split there). Slice 5 = authed Relay `companies` query; Slice 10 = mutations `createCompany`/`updateCompany`/`deleteCompany`(soft)/`destroyCompany`(hard) (name-only input, reusing the Slice 7 write helpers + Slice 6 permissions; denials→`FORBIDDEN`/`BAD_USER_INPUT`/`NOT_FOUND`/`UNAUTHENTICATED` with http.status). Live-verified mutation flow net-zero. **Deferred:** the full metadata-driven dynamic schema, all other types, generic/metadata-driven GraphQL, composite/relation input fields, filters/orderBy/pagination, replacing `/graphql`, subscriptions, codegen parity |
| Standard objects CRUD (Company first) | ✅ | | Slices 2 + 7: full native Company REST — `GET`/`POST /rest/companies` (list+create) and `GET`/`PATCH`+`PUT`/`DELETE /rest/companies/:id`. DELETE is upstream-faithful (hard destroy by default; `?soft_delete=true` soft-deletes via deletedAt); reads filter `deletedAt IS NULL`; each method permission-gated (read/update/softDelete/destroy). Live-verified in-process + HTTP, net-zero. Auth/permission guards DRY'd into `app/lib/http.ts`. Remaining: batch, filter/order/depth, restore, composite-field updates |
| Generic object REST CRUD (metadata-driven) | 🔁 | | Slices 8–9: `app/lib/records.ts` + `app/rest/[object]/route.ts` (GET list, POST create) + `[object]/[id]` (GET/PATCH+PUT/DELETE) serve full CRUD for **any** standard object's SCALAR fields, all derived from `fieldMetadata` (resolve by `namePlural` → table; writable = active non-system scalars minus POSITION; per-type value casts text/uuid/double/numeric/boolean/timestamptz/date/jsonb; unknown-field/empty/bad-type → 400; required-field pre-check; createdBy* omitted → DB default; DELETE hard-by-default / `?soft_delete=true` soft; identifier-guarded). Envelopes keyed dynamically (`data.{namePlural}`/`data.create{Singular}`/`update{Singular}`/`delete{Singular}`); auth + per-op permission (read/create/update/softDelete/destroy); system objects + reserved segments proxy to legacy. Live-verified vs `workflow` (read) + `note` (write) in-process + HTTP, net-zero; companies static routes unaffected. **Deferred:** composite/relation/enum writes, batch/restore/groupBy/merge, filter/order/depth/pagination, createdBy='API' attribution, folding companies in |
| Messaging import | ⬜ | | Inngest job |
| Calendar import | ⬜ | | Inngest job |
| Workflow engine | ⬜ | | Inngest |
| Billing | ⬜ | | |
| GraphQL subscriptions | ⬜ | | last; SSE/polling or Ably |
| Background jobs infra (Inngest) | 🔁 | | Slice 4: `inngest` + `app/api/inngest/route.ts` serve endpoint (the Vercel-native replacement for the always-on BullMQ worker). Job logic factored as plain testable libs in `app/lib/jobs/*`; Inngest fns are thin `step.run` wrappers in `app/lib/inngest/functions/*` |
| Cron jobs (22) → Inngest scheduled fns | 🔁 | | Slice 4 FIRST: `workspace-metrics-snapshot` cron (`TZ=UTC 30 2 * * *`) — counts active workspaces + per-workspace companies, idempotent record into core.keyValuePair. Live-verified net-zero. Other ~21 (trash/suspended/onboarding cleanup, event-log→ClickHouse, signing-key rotation, workflow runs, billing reminder…) deferred |
| Event-driven jobs | 🔁 | | Slice 4: `company.created` event emitted (best-effort) from `POST /rest/companies` → `company-created` Inngest fn (read-only reaction). Per-workspace fan-out + a MessageQueue-parity dispatch facade deferred |
| ClickHouse analytics | ⬜ | | external or defer |

> When the upstream-scout produces a backend port worklist, add/refresh rows here so the ledger always reflects what's left.
