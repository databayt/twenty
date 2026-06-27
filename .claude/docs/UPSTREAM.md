# The Divergence Contract — how this fork tracks twentyhq/twenty

> **The original is the important.** We follow upstream Twenty to benefit from its support, optimization, and community. We change the **minimum**. We host on **Vercel** and use **Next.js** for the backend — but we keep it **easy to always pull what we can directly pull, or pull a refactor at minimum.**

This is the rulebook the `.claude/` config enforces. Read it before any sync, port, or "let me just edit this file" moment.

## The four rules

1. **Upstream is the source of truth.** `main` is a clean, **fast-forward-only mirror** of `upstream/main`. Never commit to `main` directly. Update it with:
   ```
   git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main
   ```
   If `--ff-only` ever fails, `main` was dirtied — fix that first; it must always equal an exact upstream commit so `git diff upstream/main` is meaningful.

2. **All custom work is additive and isolated** on the integration branch (`integrationBranch` in `.claude/upstream-state.json`; currently `feat/hogwarts-workspace-setup`, recommended rename → `databayt`). Prefer **new files** or the **`packages/twenty-api` port layer** over in-place edits to upstream source. `git diff main...<integrationBranch>` must always read as a clean "everything we added."

3. **Frontend pulls directly; backend pulls a refactor.**
   - **Direct-pull** (`twenty-front`, `twenty-shared`, `twenty-ui`, `twenty-emails`): merge/rebase upstream 1:1, build-validate. These stay ~identical to upstream.
   - **Port** (`twenty-server`): we do **not** run NestJS on Vercel. We re-express upstream backend behavior in the Next.js `twenty-api`. Upstream backend changes become a **port worklist**, not a merge.

4. **`twenty-server` is the reference, not a target.** Keep it intact and mergeable. It is (a) the spec we port from, (b) the diff target for the porter, and (c) the proxy fallback the strangler facade calls until each route is ported. **Never hand-edit it** to fix a sync.

## Branch model
```
upstream (twentyhq/twenty, read-only)
        │  git fetch upstream
        ▼
      main  ── fast-forward-only mirror, never commit here
        │  rebase (default) / merge (fallback)
        ▼
  <integrationBranch>  ── additive custom layer + packages/twenty-api
```

**Rebase vs merge:** default **rebase** the custom layer onto a freshly-mirrored `main` — it keeps a linear, auditable patch series so `git diff main...<integrationBranch>` and `git log main..<integrationBranch>` stay legible. Cost: a coordinated force-push of the integration branch (fine for a small team; force-push is intentionally **not** allowlisted, so it's a human gate). **Merge fallback:** when several people have concurrent work on the integration branch, `git merge main` instead and accept merge commits; squash-clean at the next quiet point. Set `frontendStrategy` in `.claude/upstream-state.json` accordingly.

## State tracking
- `.claude/upstream-state.json` — committed source of truth: last-synced upstream SHA, date, release tag, strategy, and the pending backend worklist.
- Annotated tags `upstream-synced/<YYYY-MM-DD>` — one per sync, pointing at the integrated upstream SHA, for native `git log upstream-synced/<prev>..upstream/main` diffing. (We make these ourselves; upstream's own tags aren't tracked.)

## Known divergence set (keep this short — every entry is rebase friction)
In-place edits to upstream source we currently carry. Convert to additive overlays or upstream contributions when feasible.

| Path | What | Why | Plan |
| --- | --- | --- | --- |
| `packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant.ts` | hogwarts workspace + abdout/ali users (pwd 1234) | databayt demo data | move to an additive seed module |
| `packages/twenty-server/src/engine/workspace-manager/dev-seeder/data/constants/hogwarts-company-data-seeds.constant.ts` | hogwarts company seeds | databayt demo data | additive seed module |
| `packages/twenty-server/src/engine/workspace-manager/dev-seeder/data/constants/workspace-member-data-seeds.constant.ts` | seed members | databayt demo data | additive seed module |
| `packages/twenty-server/src/.../passwordRegex.ts`, `auth.util.ts`, `instrument.ts` | small auth/instrumentation tweaks | (confirm during first sync) | evaluate: revert, override, or upstream |

> The `divergence-auditor` agent re-derives this list from git; keep this table in sync with reality during each `/upstream-sync`.

## Things we deliberately keep additive (not divergence — these are ours, in new files)
- The deploy kit (`packages/twenty-docker/*oracle*`, `HANDOFF.md`), `vercel.json`, `packages/twenty-front/scripts/vercel-inject-env-config.mjs`, Neon link, `.claude/`, and the future `packages/twenty-api`.

## Deferred
- **RTL**: upstream already ships an `ar-SA` Lingui locale but no `dir=rtl` wiring. When we add it, prefer **contributing upstream** (the community benefits and maintains it) over carrying a fork patch.
