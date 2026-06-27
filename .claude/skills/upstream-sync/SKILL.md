---
name: upstream-sync
description: Pull the latest from twentyhq/twenty into this fork. Dual-mode — frontend/shared/ui/emails are merged directly and build-validated; twenty-server changes are surfaced as a backend port worklist (we re-implement them in the Next.js packages/twenty-api, never merge them). Use whenever the user says "pull upstream", "sync with twenty", "update from the original repo", or "what's new upstream".
---

# /upstream-sync — track twentyhq/twenty without losing the Vercel/Next.js refactor

The contract this skill enforces lives in `.claude/docs/UPSTREAM.md`. Read it if anything here is ambiguous. Core idea: **upstream is the spec.** Frontend tracks it 1:1; backend "pulls a refactor."

State lives in `.claude/upstream-state.json` (committed) + annotated git tags `upstream-synced/<date>` (one per sync, pointing at the upstream SHA we integrated up to). Use both: the file carries the worklist/strategy, the tag gives native `git log <tag>..upstream/main` diffing.

## Phase 0 — Preflight
1. Read `.claude/upstream-state.json` → `lastSyncedUpstreamSha`, `integrationBranch`, `frontendStrategy`, `mirrorBranch` (default `main`).
2. Ensure the `upstream` remote exists and is correct:
   - `git remote get-url upstream` — if missing, `git remote add upstream https://github.com/twentyhq/twenty.git`.
3. `git fetch upstream --prune` (tags not needed — upstream tags aren't tracked; we make our own).
4. **Refuse to proceed on a dirty tree** — `git status --porcelain` must be empty. A sync must be auditable. Tell the user to commit/stash first.
5. Record the current `upstream/main` SHA as `TARGET_SHA` (`git rev-parse upstream/main`).

## Phase 1 — Intelligence (delegate to the `upstream-scout` agent)
Spawn the **upstream-scout** subagent so the large diff stays out of the main context. Give it `lastSyncedUpstreamSha` and `TARGET_SHA`. It must return:
- A path-bucketed commit summary: **direct-pull** packages (`twenty-front`, `twenty-shared`, `twenty-ui`, `twenty-emails`) vs **port** package (`twenty-server`) vs infra/config.
- Release + notable-PR highlights from the **github MCP** (`list_releases` / `get_latest_release` for newer than `upstreamReleaseTag`; `list_pull_requests` filtered to merged with labels like `security`, `migration`, breaking-change). Call out any DB migration or breaking change.
- A grouped **backend port worklist**: one item per changed backend area `{ area, upstreamRange, files[], behaviorDelta, migration?: true }`.

Present this summary to the user before mutating anything.

## Phase 2a — Direct merge: frontend / shared / ui / emails
These track upstream 1:1.
1. Bring the mirror up first: `git checkout main && git merge --ff-only upstream/main`. If ff fails, `main` has been dirtied — stop and report (it must stay a pure mirror; see UPSTREAM.md).
2. Update the integration branch. Default `frontendStrategy: "rebase"` (linear, auditable patch series):
   - `git checkout <integrationBranch>` then `git rebase main`.
   - Fallback `merge` (set `frontendStrategy: "merge"` when teammates have concurrent work): `git merge main`.
   - **Do not push and do not force-push** — leave that to the human (these are not allowlisted on purpose).
3. Conflict handling (rare — our FE edits are minimal): prefer upstream's version, then re-apply our additive intent. If one of our in-place FE edits conflicts, flag it as a candidate to convert into an additive override (UPSTREAM.md, "known divergence set") rather than re-resolving in place every sync.
4. **Validate** (the frontend is what Vercel serves — it must stay green):
   ```
   npx nx build twenty-shared
   npx nx build twenty-front
   npx nx typecheck twenty-front
   npx nx lint:diff-with-main twenty-front
   ```
   If upstream changed the GraphQL schema, also run `npx nx run twenty-front:graphql:generate`.

## Phase 2b — Port mode: twenty-server (never merge into the Next.js backend)
1. Do **not** merge upstream `twenty-server` into `packages/twenty-api`. The legacy `twenty-server` still receives upstream changes naturally on the integration branch (it's upstream source we keep intact) — that is the **living reference** we port from.
2. For each worklist item, either:
   - Append it to `pendingBackendWorklist` in `.claude/upstream-state.json` for later, OR
   - If the user wants it now, invoke the **/backend-port** skill (or the `backend-porter` agent) on that one item.
3. Update `.claude/docs/MIGRATION-LEDGER.md` if any item changes a module's status.

## Phase 3 — Record & report
1. Update `.claude/upstream-state.json`: `lastSyncedUpstreamSha = TARGET_SHA`, `lastSyncedDate` (ask the user or use the session date — never invent one), `upstreamReleaseTag`, refreshed `pendingBackendWorklist`.
2. Create the sync tag: `git tag -a upstream-synced/<YYYY-MM-DD> <TARGET_SHA> -m "synced to upstream/main @ <short-sha>"`.
3. Final report:
   - ✅ Frontend/shared merged cleanly (or conflicts resolved, list them).
   - 📋 Backend worklist: queued vs ported this run.
   - 📰 Release/PR highlights worth knowing (security, migrations, breaking).
   - ⚠️ Any new divergence debt created.
   - Next action for the human: review `git diff main...<integrationBranch>`, then push when satisfied.

## Guardrails
- Never `git push` / `git push --force` / `git reset --hard` automatically — these are intentionally not allowlisted.
- Never hand-edit `packages/twenty-server/**` to "fix" a sync. Port instead.
- Never invent the date. Keep `main` a pure ff-only mirror.
