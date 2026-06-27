# `.claude/` — Twenty fork config (databayt)

This directory is **committed** so the whole databayt team (and the sales department's CRM work) inherits the same workflow. It layers Twenty-specific tooling on top of the rich global `~/.claude` config — it does **not** duplicate the generic agents/skills (nextjs, prisma, deploy, i18n, check, ship, …) that already live there.

## North star
**Follow upstream twentyhq/twenty; change the minimum.** Host on Vercel with a Next.js backend, but keep it easy to always pull what we can directly pull, or pull a refactor at minimum. The full rulebook is **[`docs/UPSTREAM.md`](docs/UPSTREAM.md)** — read it first.

## What's here
| Path | Purpose |
| --- | --- |
| `docs/UPSTREAM.md` | The divergence contract + branch model + known-divergence set. **Start here.** |
| `docs/VERCEL-BACKEND.md` | Target architecture for the Next.js backend (`packages/twenty-api`). |
| `docs/MIGRATION-LEDGER.md` | Living board of the NestJS→Next.js migration. |
| `upstream-state.json` | Source of truth for the last upstream sync point + backend port worklist. |
| `settings.json` | Permission allowlist (read-only git/nx/gh/vercel + github MCP) and hook wiring. |
| `skills/upstream-sync/` | **`/upstream-sync`** — pull from twentyhq/twenty (FE direct-merge, BE port worklist). |
| `skills/backend-port/` | **`/backend-port`** — re-implement one upstream backend change in `twenty-api`. |
| `skills/vercel-backend/` | **`/vercel-backend`** — conventions/scaffolding for `twenty-api`. |
| `skills/workspace-seed/` | **`/workspace-seed`** — reset + seed the hogwarts demo workspace. |
| `agents/upstream-scout.md` | Read-only: what changed upstream + the backend port worklist. |
| `agents/backend-porter.md` | Port one worklist item → Next/Prisma + fidelity checklist. |
| `agents/divergence-auditor.md` | Read-only: how far we've drifted; flags in-place edits. |
| `hooks/upstream-status.sh` | SessionStart nudge when upstream has drifted. |
| `hooks/divergence-guard.sh` | Advisory warning on in-place edits to upstream source. |

## MCP (project `.mcp.json`)
`postgres` (read-only inspection), `playwright`, `context7`, and **`github`** (releases/PRs/commits/code-search on twentyhq/twenty — powers the sync). The github MCP reads `GITHUB_TOKEN` from the environment; **never commit a token.**

## Typical loop
1. New session prints upstream drift (the SessionStart hook).
2. `/upstream-sync` — review what's new, merge frontend, queue/port backend changes.
3. `/backend-port` items from the worklist into `packages/twenty-api`.
4. `/workspace-seed` for a clean demo; deploy the frontend to Vercel (see `HANDOFF.md`).

## One-time setup (not done automatically)
- Set `GITHUB_TOKEN` in your shell env for the github MCP.
- Add the upstream remote: `git remote add upstream https://github.com/twentyhq/twenty.git` (the `/upstream-sync` skill also does this).
- The integration branch is `databayt` (renamed from `feat/hogwarts-workspace-setup`); it's tracked by `integrationBranch` in `upstream-state.json`.
- Local-only overrides go in `.claude/settings.local.json` (gitignored).
