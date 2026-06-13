# Deploy Twenty CRM for free on an Oracle Cloud "Always Free" VM

The whole app — API + background worker + Postgres + Redis + the frontend —
runs on **one free VM**, fronted by Caddy with automatic HTTPS.

```
                          Internet
                             │  :80 / :443
                    ┌────────▼────────┐
                    │      Caddy      │  auto-HTTPS (Let's Encrypt)
                    └────────┬────────┘
                             │ server:3000
        ┌────────────────────┼───────────────────────┐
        │                    │                        │
   ┌────▼────┐         ┌─────▼─────┐            ┌──────▼──────┐
   │ server  │ jobs ──▶│   redis   │◀── jobs ───│   worker    │
   │ API+SPA │         └───────────┘            │ (BullMQ)    │
   └────┬────┘                                  └──────┬──────┘
        │                  ┌───────────┐               │
        └─────────────────▶│ postgres  │◀──────────────┘
                           │ (on disk) │
                           └───────────┘
```

**Cost: $0/month, permanent.** Oracle's Always Free ARM (Ampere A1) tier gives
up to 4 cores / 24 GB RAM / 200 GB disk that never expires — far more than Twenty
needs. Twenty's image is multi-arch (`arm64`), so it runs natively.

> Trade-off: this is a VM **you** run. Day-to-day it's `docker compose ... up -d`
> and the occasional update. There is no free *managed* platform that can run
> Twenty's always-on worker + Redis — see the bottom of this file for why.

---

## What's in this folder

| File | Purpose |
|---|---|
| `docker-compose.oracle.yml` | The full single-host stack (Caddy, server, worker, db, redis). |
| `Caddyfile.oracle` | Reverse proxy + automatic HTTPS. |
| `.env.oracle.example` | Env template — copied to `.env` (gitignored) on first deploy. |
| `oracle-deploy.sh` | One command: generates secrets, then `up -d`. |

---

## 1. Create the free VM

1. Sign up at <https://cloud.oracle.com> → choose **Always Free** (a card is
   required for identity verification; the Always Free resources are never
   charged).
2. **Compute → Instances → Create instance:**
   - **Image:** Ubuntu 22.04 (or 24.04).
   - **Shape:** *Ampere* → **VM.Standard.A1.Flex** → **4 OCPU / 24 GB** (all
     within Always Free). If A1 capacity is unavailable in your region, try a
     different availability domain or region, or start with 2 OCPU / 12 GB.
   - **Networking:** keep the default VCN; **assign a public IPv4**.
   - **SSH keys:** upload/generate and save your key.
3. Note the instance's **public IP**.

## 2. Open ports 80 and 443

Two layers must allow traffic on Oracle:

**a) VCN Security List** (Console → Networking → your VCN → Security Lists →
default → Add Ingress Rules), source `0.0.0.0/0`, TCP, for **80** and **443**.

**b) The instance firewall** (Ubuntu images ship with iptables locked to SSH):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Install Docker

SSH in (`ssh ubuntu@<public-ip>`), then:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
exit   # log out and back in so the docker group applies
```

`docker compose version` should now work (the plugin ships with the script).

## 4. Point DNS at the VM

**Your `databayt.org` DNS is managed by Vercel** (`ns1/ns2.vercel-dns.com`), and
`crm.databayt.org` currently resolves to Vercel. Repoint it to the VM:

1. **Vercel → your `twenty` project → Settings → Domains:** remove
   `crm.databayt.org` and `*.crm.databayt.org` (so Vercel stops serving them).
2. **Vercel → Domains → `databayt.org` → DNS records:** add an **A** record
   - Name `crm` → value `<your VM public IP>`
   - *(multi-tenant only)* Name `*.crm` → value `<your VM public IP>`
3. Wait for propagation: `dig +short crm.databayt.org` should return your VM IP.

> HTTPS won't issue until `crm.databayt.org` resolves to the VM and ports 80/443
> are open.

## 5. Get the files and deploy

The runtime image is pulled from Docker Hub, so you only need this folder:

```bash
# The kit currently lives on the feat/hogwarts-workspace-setup branch.
# (Merge it to main and drop the -b flag once you do.)
git clone --depth 1 -b feat/hogwarts-workspace-setup https://github.com/abdout/twenty.git
cd twenty/packages/twenty-docker
./oracle-deploy.sh           # creates .env, then tells you to set DOMAIN/ACME_EMAIL
nano .env                    # set DOMAIN=crm.databayt.org and a real ACME_EMAIL
./oracle-deploy.sh           # generates secrets and brings the stack up
```

First boot runs database migrations and registers cron jobs automatically
(watch with `docker compose -f docker-compose.oracle.yml logs -f server`).

## 6. Verify

- Open **https://crm.databayt.org** — the first request provisions the TLS cert
  (~30 s), then you'll see Twenty.
- Create your admin user / workspace through the sign-up screen, **or** seed the
  hogwarts workspace (users `abdout` / `ali`) you already scripted:

  ```bash
  # adjust to your seeder's actual command/target
  docker compose -f docker-compose.oracle.yml exec server \
    yarn command:prod workspace:seed:hogwarts
  ```

---

## Multi-tenant subdomains (optional upgrade)

Twenty puts each workspace on its own subdomain when multi-workspace is on.

1. Add the `*.crm` A record (step 4.2) → VM IP.
2. In `docker-compose.oracle.yml` (the `server` service), **uncomment** these two
   lines:
   ```yaml
   IS_MULTIWORKSPACE_ENABLED: "true"
   DEFAULT_SUBDOMAIN: ${DEFAULT_SUBDOMAIN:-app}
   ```
   > Don't set this in `.env` — the server reads it by truthiness, so the string
   > `"false"` would also turn it **on**. Omit it for single-workspace; set it to
   > `"true"` only to enable multi-tenant.
3. In `Caddyfile.oracle`: swap the single-domain block for the commented
   wildcard / `on_demand_tls` block at the bottom of that file.
4. `./oracle-deploy.sh` to apply.

**On-demand TLS** (the commented block) issues a cert per subdomain on first
request — no DNS API needed, but Let's Encrypt caps new certs at ~50/week per
domain. **For many workspaces**, get one wildcard cert via the **DNS-01**
challenge instead. Vercel DNS has no first-class Caddy plugin, so the clean path
is to move `crm.databayt.org`'s DNS to **Cloudflare** (free) and use a
Caddy+Cloudflare image with `tls { dns cloudflare <API_TOKEN> }`. Ask and I'll
wire that variant.

---

## Operations

```bash
cd twenty/packages/twenty-docker
C="docker compose -f docker-compose.oracle.yml"

$C ps                       # status
$C logs -f server worker    # tail logs
$C pull && $C up -d         # update to the latest image
$C down                     # stop (data is kept in named volumes)

# Backup Postgres (the only stateful piece besides uploaded files):
$C exec db pg_dump -U postgres default | gzip > backup-$(date +%F).sql.gz
# Restore:
gunzip -c backup-YYYY-MM-DD.sql.gz | $C exec -T db psql -U postgres default
```

Uploaded files live in the `server-local-data` volume (`STORAGE_TYPE=local`).

---

## Security: rotate the leaked Neon credential

`packages/twenty-docker/.env.production` was committed to a **public** repo with
a live Neon password (`neondb_owner` / `npg_HFP2aDSzvi0t…`). That secret is
burned. This folder no longer uses Neon (Postgres runs on the VM), but you must
still neutralize the exposed credential:

- **Neon console → your project → Roles → `neondb_owner` → Reset password**, or
  **delete the project** entirely if it's unused.
- The file is now `git rm --cached`'d and gitignored (`**/.env.production`), so
  it won't be committed again — but it remains in git **history**. Rotating the
  password is what actually closes the hole; optionally purge history later with
  `git filter-repo`.

All real secrets now live only in the gitignored `.env` on the VM.

---

## Why not a free managed platform (Render/Railway/Vercel)?

Twenty is two always-on processes (`server` + `worker`) plus Redis. Free managed
tiers either **sleep on idle** (Render free, Koyeb), **don't run background
workers for free** (Render), are **no longer free** (Railway), or are
**request-only with no always-on process** (Vercel, Cloud Run). The worker drives
email/calendar sync, workflows and cron — drop it and those silently never run.
A free VM is the only option that runs the entire app 24/7 at $0.
