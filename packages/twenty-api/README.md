# twenty-api — Vercel-native Next.js backend (strangler-fig)

The incremental replacement for the NestJS `twenty-server`, built to run on Vercel. It stands in front
of the legacy server and **proxies everything to it**, then ports modules over one at a time until the
legacy server is empty. Full architecture + the Vercel-native replacement map (Prisma/Neon, Upstash,
Inngest, GraphQL Yoga) live in [`.claude/docs/VERCEL-BACKEND.md`](../../.claude/docs/VERCEL-BACKEND.md);
migration progress is tracked in [`.claude/docs/MIGRATION-LEDGER.md`](../../.claude/docs/MIGRATION-LEDGER.md).

> Part of Twenty. Licensed **AGPL-3.0** (see the repo root `LICENSE`).

## Status: Slice 0 — the facade
- `app/healthz/route.ts` — native handler (proves twenty-api runs).
- `app/graphql/route.ts` — **proxies** to `${LEGACY_SERVER_URL}/graphql` (kept whole until the GraphQL milestone; never split the schema partially).
- `app/[...slug]/route.ts` — catch-all that proxies every other path verbatim (`/metadata`, `/rest/*`, `/files`, `/auth/*`, …).
- `app/lib/proxy.ts` — the passthrough; `app/lib/ported-routes.ts` — the native-vs-proxied registry.

Point the frontend's `REACT_APP_SERVER_BASE_URL` at this app and nothing changes functionally — that's
the proof Slice 0 gives: Vercel + the Nx monorepo build + connectivity to the legacy backend all work.

## Develop
```bash
cp .env.example .env          # set LEGACY_SERVER_URL to a running twenty-server
npx nx dev twenty-api         # http://localhost:3002  (proxies to LEGACY_SERVER_URL)
curl localhost:3002/healthz   # native; returns service status
npx nx build twenty-api       # production build (what Vercel runs)
npx nx typecheck twenty-api
```

## Deploy (its own Vercel project)
Set the Vercel project **Root Directory** to `packages/twenty-api`, framework **Next.js**, and env
`LEGACY_SERVER_URL` to the running legacy server. Then point the frontend at this deployment.

## Porting a module here
Use the `/backend-port` skill: read the upstream NestJS reference, re-express it as a route handler +
Prisma, give it a route file (it takes precedence over the catch-all), register the prefix in
`app/lib/ported-routes.ts`, and flip it from proxied → native in the ledger.
