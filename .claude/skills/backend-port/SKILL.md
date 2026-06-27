---
name: backend-port
description: Port ONE upstream twenty-server (NestJS + TypeORM) changeset into the Vercel-native Next.js backend at packages/twenty-api (Next 16 route handlers + Prisma 6). This is "pull a refactor at minimum" — re-express upstream backend behavior, don't merge it. Use when working through the pendingBackendWorklist or when the user says "port this backend change" / "re-implement this resolver in twenty-api".
---

# /backend-port — re-express one upstream backend change in twenty-api

Upstream `twenty-server` is the **spec and the living reference**. We never edit it and never merge it into `packages/twenty-api`; we re-implement its behavior in the Next.js backend. Read `.claude/docs/VERCEL-BACKEND.md` for the target architecture and the Vercel-native replacement map.

## Input
A single worklist item (from `.claude/upstream-state.json → pendingBackendWorklist`):
`{ area, upstreamRange, files[], behaviorDelta, migration? }`.

## Procedure
1. **Study the reference.** Read the upstream NestJS source for this area under `packages/twenty-server/src/**` (controllers/resolvers/services/entities/migrations named in `files[]`). Use the `backend-porter` agent to isolate this reading in its own context and return a fidelity checklist.
2. **Classify the surface:**
   - REST controller → a Next route handler under `packages/twenty-api/app/rest/...`.
   - GraphQL resolver → a Yoga resolver in `packages/twenty-api/app/graphql/` (but keep `/graphql` proxied to legacy until the dedicated GraphQL milestone — see VERCEL-BACKEND.md; do not partially split the schema).
   - TypeORM entity on `core`/`metadata` → a Prisma 6 model.
   - `@WorkspaceEntity` / workspace-migration logic → the ported `workspace-migration-runner` (raw DDL via `prisma.$executeRawUnsafe`, per-workspace data via `$queryRawUnsafe` with `search_path`).
   - Background job / cron → an Inngest function (`packages/twenty-api/app/api/inngest/`).
3. **Map dependencies to Vercel-native equivalents** (VERCEL-BACKEND.md table): Redis→Upstash, BullMQ/cron→Inngest, sessions→Upstash/iron-session, subscriptions→SSE/polling (defer), DB→Neon via Prisma.
4. **Re-express, don't transcribe.** Match behavior (inputs, outputs, auth/tenant scope, error shapes, side effects), not NestJS structure. Preserve the metadata-driven model so future upstream changes stay portable.
5. **Tenant + auth parity is mandatory.** Every ported handler must enforce the same workspace scoping and auth the NestJS original did. This is the #1 correctness risk.
6. **Flip the route registry.** Move the path from "proxy" to "native" in the `ported-routes` registry so the strangler facade serves it natively and stops proxying to legacy.
7. **Validate:** `npx nx build twenty-api && npx nx typecheck twenty-api`; if Prisma changed, regenerate the client and review the migration; exercise the route against a seeded Neon workspace and compare the response to legacy `twenty-server` for the same request.
8. **Record:** update `.claude/docs/MIGRATION-LEDGER.md` (module → ported), and remove the item from `pendingBackendWorklist`.

## Guardrails
- Never delete or edit `twenty-server` — it's the reference and the proxy fallback.
- Don't port REST-first for user-visible wins: the SPA is GraphQL-first, so most value lands only when GraphQL is served natively. Sequence per VERCEL-BACKEND.md.
- Carry the AGPL-3.0 notice into new files where appropriate.
