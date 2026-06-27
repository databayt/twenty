# Handoff: deploy Twenty CRM at crm.databayt.org

**Goal:** Get Twenty (open-source CRM) running 24/7 at `crm.databayt.org` for ~$0/mo.

**Repo:** <https://github.com/abdout/twenty> → branch **`databayt`**
**Read first:** [`packages/twenty-docker/ORACLE_FREE_DEPLOY.md`](packages/twenty-docker/ORACLE_FREE_DEPLOY.md) — the full runbook. The whole deploy kit (compose file, Caddy config, env template, deploy script) lives in that folder.

## Done ✅
- App builds; deploy kit written (one VM runs API + worker + Postgres + Redis + Caddy/HTTPS).
- Seeder ready: hogwarts workspace, users `abdout` / `ali`, password `1234`.
- DNS for `databayt.org` is on Vercel; the `crm` subdomain currently points at Vercel.

## Left to do ⏳
1. Get a host (see options below).
2. Open ports **80/443** — VCN security list **and** iptables (runbook §2).
3. Install Docker (runbook §3).
4. Repoint `crm.databayt.org` DNS from Vercel → the VM's public IP (runbook §4).
5. Deploy:
   ```bash
   git clone -b databayt https://github.com/abdout/twenty.git
   cd twenty/packages/twenty-docker
   ./oracle-deploy.sh
   ```
   (runbook §5)
6. ⚠️ **Security:** rotate the leaked Neon DB password — it's in git history. See the "Security" section of the runbook.

## Host options
- **Oracle Always Free (the plan):** 1 free VM, `VM.Standard.A1.Flex` 4 OCPU / 24 GB, $0 forever.
  Catch: **trial accounts keep hitting "out of capacity"** (our Abu Dhabi account did). Real fix =
  upgrade to **Pay-As-You-Go** (stays $0 within free limits, but gets capacity priority). PAYG only
  works if **billing country = the card's country**. Our card is **UAE** → sign up with **UAE country
  + Dubai region**, then upgrade to PAYG.
- **Not Oracle (if A1 stays dry):** **Hetzner CAX21** (ARM, 4 vCPU / 8 GB, ~€7/mo) runs the exact
  same `docker-compose.oracle.yml` unchanged. Reliable and cheap.
- **Vercel = dead end** for the backend — it can't run Twenty's always-on worker + Redis. Don't host
  the API there. (Why: see the bottom of the runbook.)

## Continue vs start over
Everything is in the repo — just `git clone` the branch and follow the runbook. No need to start over;
only the **host** needs solving.
