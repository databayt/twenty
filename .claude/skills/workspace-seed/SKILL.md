---
name: workspace-seed
description: Reset the dev database and seed the databayt hogwarts demo workspace (users abdout/ali, password 1234) so teammates and the sales team get an identical CRM to demo. Use when the user says "seed", "reset the db", "set up the demo workspace", or after a destructive DB change.
---

# /workspace-seed — reset + seed the hogwarts demo workspace

This wraps Twenty's dev seeder, which we've customized with databayt demo data (the hogwarts workspace, the abdout/ali users, hogwarts company seeds). Use it so everyone runs the seed the same way.

## What it does
`npx nx database:reset twenty-server` runs the migrations and then, by default (the `seed` configuration → `workspace:seed:dev`), seeds the dev workspace. Our customizations live in:
- `packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant.ts` (hogwarts workspace + abdout/ali users, password `1234`)
- `packages/twenty-server/src/engine/workspace-manager/dev-seeder/data/constants/hogwarts-company-data-seeds.constant.ts`
- related `workspace-member-data-seeds.constant.ts`

> These are **in-place edits to upstream source** → known divergence. The divergence-guard hook will warn when you touch them. Keep them minimal and listed in `.claude/docs/UPSTREAM.md`'s "known divergence set" so the rebase stays clean. (Longer term, consider moving demo seeds into an additive seed module.)

## Procedure
1. Confirm services are up (Postgres + Redis): `bash packages/twenty-utils/setup-dev-env.sh` if needed.
2. **Destructive — confirm with the user first** (this wipes the dev DB).
3. Run: `npx nx database:reset twenty-server`
   - To reset without seeding: `npx nx database:reset twenty-server --configuration=no-seed`.
4. Verify via the postgres MCP or by logging into the app: use **"Continue with Email"** (prefilled creds) — `abdout` / `1234`.

## Guardrails
- Never run against a production/Neon URL — this resets the database. Confirm the target DB (`packages/twenty-server/.env → PG_DATABASE_URL`) is local/dev first.
