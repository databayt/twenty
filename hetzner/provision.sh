#!/usr/bin/env bash
# Provision the Twenty CRM backend host on Hetzner Cloud and point crm-api.databayt.org at it.
# Idempotent: reuses the SSH key, firewall and server it finds by name. Modeled on
# hogwarts/infra/livekit/provision.sh.
#
#   hetzner/provision.sh          create or reuse, then wait for SSH
#   hetzner/provision.sh --plan   print the type/location/price, create nothing
#
# Keychain: hetzner-cloud-token · cloudflare-zones (DNS edit on databayt.org)
# SSH: ~/.ssh/hetzner_twenty — `ssh -i ~/.ssh/hetzner_twenty root@crm-api.databayt.org`
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
NAME=${TW_SERVER_NAME:-twenty-1}
DOMAIN=${TW_DOMAIN:-crm-api.databayt.org}
TYPES=${TW_TYPES:-"cx23 cax11"}   # 2 vCPU / 4 GB, cheapest first
LOCATIONS=${TW_LOCATIONS:-"fsn1 nbg1 hel1"}
PLAN_ONLY=false; [[ "${1:-}" == "--plan" ]] && PLAN_ONLY=true

H=https://api.hetzner.cloud/v1
HT=$(security find-generic-password -s hetzner-cloud-token -w)
hz() { curl -fsS -H "Authorization: Bearer $HT" -H "Content-Type: application/json" "$@"; }
py() { python3 -c "$1"; }

read -r TYPE LOC PRICE < <(hz "$H/server_types?per_page=50" | TYPES="$TYPES" LOCS="$LOCATIONS" python3 -c '
import json, os, sys
types = json.load(sys.stdin)["server_types"]
for tn in os.environ["TYPES"].split():
    t = next((x for x in types if x["name"] == tn and not x.get("deprecation")), None)
    if not t: continue
    for ln in os.environ["LOCS"].split():
        p = next((p for p in t["prices"] if p["location"] == ln), None)
        if p: print(tn, ln, p["price_monthly"]["gross"]); sys.exit(0)
sys.exit("no orderable server type")
')
echo "==> $TYPE in $LOC — €$(printf %.2f "$PRICE")/month gross"
$PLAN_ONLY && exit 0

PUB=$(cat ~/.ssh/hetzner_twenty.pub)
KEY_ID=$(hz "$H/ssh_keys?name=twenty-databayt" | py 'import json,sys; k=json.load(sys.stdin)["ssh_keys"]; print(k[0]["id"] if k else "")')
[[ -z "$KEY_ID" ]] && KEY_ID=$(hz -X POST "$H/ssh_keys" --data "$(PUB="$PUB" py 'import json,os; print(json.dumps({"name":"twenty-databayt","public_key":os.environ["PUB"]}))')" | py 'import json,sys; print(json.load(sys.stdin)["ssh_key"]["id"])')
echo "==> ssh key $KEY_ID"

# Only SSH + HTTP(S). Postgres, Redis and Hermes' tunnel port stay closed to the internet.
FW_ID=$(hz "$H/firewalls?name=twenty" | py 'import json,sys; f=json.load(sys.stdin)["firewalls"]; print(f[0]["id"] if f else "")')
[[ -z "$FW_ID" ]] && FW_ID=$(hz -X POST "$H/firewalls" --data "$(py '
import json
anyw = ["0.0.0.0/0", "::/0"]
r = lambda port: {"direction": "in", "protocol": "tcp", "port": port, "source_ips": anyw}
print(json.dumps({"name": "twenty", "rules": [r("22"), r("80"), r("443"),
  {"direction": "in", "protocol": "icmp", "source_ips": anyw}]}))')" | py 'import json,sys; print(json.load(sys.stdin)["firewall"]["id"])')
echo "==> firewall $FW_ID"

SRV=$(hz "$H/servers?name=$NAME" | py 'import json,sys; s=json.load(sys.stdin)["servers"]; print(s[0]["id"] if s else "")')
if [[ -z "$SRV" ]]; then
  SRV=$(hz -X POST "$H/servers" --data "$(UD="$HERE/cloud-init.yaml" NAME="$NAME" TYPE="$TYPE" LOC="$LOC" KEY="$KEY_ID" FW="$FW_ID" py '
import json, os
print(json.dumps({"name": os.environ["NAME"], "server_type": os.environ["TYPE"], "location": os.environ["LOC"],
  "image": "ubuntu-24.04", "ssh_keys": [int(os.environ["KEY"])], "firewalls": [{"firewall": int(os.environ["FW"])}],
  "user_data": open(os.environ["UD"]).read(), "labels": {"app": "twenty", "owner": "databayt"}}))')" \
    | py 'import json,sys; print(json.load(sys.stdin)["server"]["id"])')
  echo "==> created server $SRV"
fi
IP=$(hz "$H/servers/$SRV" | py 'import json,sys; print(json.load(sys.stdin)["server"]["public_net"]["ipv4"]["ip"])')
echo "==> $NAME $IP"

# DNS: A record, DNS-only (grey cloud) so Caddy gets its own Let's Encrypt cert over HTTP-01.
CT=$(security find-generic-password -s cloudflare-zones -w)
cf() { curl -fsS -H "Authorization: Bearer $CT" -H "Content-Type: application/json" "$@"; }
ZONE=$(cf "https://api.cloudflare.com/client/v4/zones?name=databayt.org" | py 'import json,sys; print(json.load(sys.stdin)["result"][0]["id"])')
REC=$(cf "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?type=A&name=$DOMAIN" | py 'import json,sys; r=json.load(sys.stdin)["result"]; print(r[0]["id"] if r else "")')
BODY=$(IP="$IP" D="$DOMAIN" py 'import json,os; print(json.dumps({"type":"A","name":os.environ["D"],"content":os.environ["IP"],"ttl":300,"proxied":False}))')
if [[ -z "$REC" ]]; then cf -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" --data "$BODY" >/dev/null
else cf -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$REC" --data "$BODY" >/dev/null; fi
echo "==> DNS $DOMAIN -> $IP"

for i in $(seq 1 60); do
  ssh -i ~/.ssh/hetzner_twenty -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "root@$IP" 'cloud-init status --wait >/dev/null 2>&1; docker compose version' 2>/dev/null && break
  sleep 10
done
echo "==> ready: ssh -i ~/.ssh/hetzner_twenty root@$IP"
