#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=".env"
OV_DIR="./data/openviking"
OV_CONF="$OV_DIR/ov.conf"

# ── Parse args ──────────────────────────────────────────────
EMB_KEY="" VLM_KEY=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --emb-key) EMB_KEY="$2"; shift 2;;
    --vlm-key) VLM_KEY="$2"; shift 2;;
    *) echo "Usage: setup.sh [--emb-key <key>] [--vlm-key <key>]"; exit 1;;
  esac
done

echo "=== Zouk Docker Setup ==="

# ── .env ────────────────────────────────────────────────────
[ ! -f "$ENV_FILE" ] && cp .env.example "$ENV_FILE" && echo "[setup] Created $ENV_FILE"

# ── OV config ───────────────────────────────────────────────
mkdir -p "$OV_DIR"
if [ ! -f "$OV_CONF" ]; then
  # Resolve model API keys: args > ~/.openviking/ov.conf > interactive
  if [ -z "$EMB_KEY" ] && [ -f "$HOME/.openviking/ov.conf" ]; then
    EMB_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.openviking/ov.conf')).get('embedding',{}).get('dense',{}).get('api_key',''))" 2>/dev/null || true)
    VLM_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.openviking/ov.conf')).get('vlm',{}).get('api_key',''))" 2>/dev/null || true)
    [ -n "$EMB_KEY" ] && echo "[setup] Reusing keys from ~/.openviking/ov.conf"
  fi
  if [ -z "$EMB_KEY" ]; then
    read -rp "  Embedding API key: " EMB_KEY
    read -rp "  VLM API key (blank = same):     " VLM_KEY
  fi
  VLM_KEY="${VLM_KEY:-$EMB_KEY}"
  [ -z "$EMB_KEY" ] && { echo "ERROR: embedding key required."; exit 1; }

  # Generate OV root API key (static config value for ov.conf)
  ROOT_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

  python3 -c "
import json
with open('ov.conf.example') as f: c = json.load(f)
c['embedding']['dense']['api_key'] = '$EMB_KEY'
c['vlm']['api_key'] = '$VLM_KEY'
c['server']['auth_mode'] = 'api_key'
c['server']['root_api_key'] = '$ROOT_KEY'
with open('$OV_CONF', 'w') as f: json.dump(c, f, indent=4)
"
  echo "[setup] Created $OV_CONF (api_key mode)"
fi

# ── Start OV + PG to mint a new-format admin key ───────────
echo "[setup] Starting OpenViking + PostgreSQL..."
docker compose up -d openviking postgres

echo -n "[setup] Waiting for OpenViking health"
for i in $(seq 1 30); do
  docker compose exec -T openviking curl -fsS http://127.0.0.1:1933/health >/dev/null 2>&1 && { echo " ready."; break; }
  [ "$i" -eq 30 ] && { echo " TIMEOUT"; docker compose logs --tail=10 openviking; exit 1; }
  echo -n "."; sleep 2
done

# Read the root key from ov.conf (needed for admin API)
ROOT_KEY=$(python3 -c "import json; print(json.load(open('$OV_CONF')).get('server',{}).get('root_api_key',''))")
[ -z "$ROOT_KEY" ] && { echo "ERROR: root_api_key not found in $OV_CONF"; exit 1; }

# Mint a new-format admin key via OV admin API inside the container.
# The new-format key encodes account info so zouk-server can provision
# per-agent keys automatically.
EXISTING_KEY=$(grep '^OPENVIKING_ROOT_KEY=' "$ENV_FILE" | cut -d= -f2-)
if [ -z "$EXISTING_KEY" ] || [ "$EXISTING_KEY" = "$ROOT_KEY" ]; then
  echo "[setup] Minting admin key for zouk via OV admin API..."
  ADMIN_RESP=$(docker compose exec -T openviking curl -fsS \
    http://127.0.0.1:1933/api/v1/admin/accounts/default/users \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ROOT_KEY" \
    -d '{"user_id": "zouk", "role": "admin"}' 2>&1) || {
    echo "WARNING: Failed to mint admin key — provisioning will be disabled"
    echo "  Response: $ADMIN_RESP"
    ADMIN_RESP=""
  }
  if [ -n "$ADMIN_RESP" ]; then
    ADMIN_KEY=$(echo "$ADMIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',{}).get('user_key',''))" 2>/dev/null || true)
    if [ -n "$ADMIN_KEY" ]; then
      sed -i.bak "s|^OPENVIKING_ROOT_KEY=.*|OPENVIKING_ROOT_KEY=$ADMIN_KEY|" "$ENV_FILE"
      rm -f "${ENV_FILE}.bak"
      echo "[setup] Admin key written to $ENV_FILE (new-format, provisioning enabled)"
    else
      echo "WARNING: Admin API returned no user_key — using raw root key (provisioning disabled)"
      sed -i.bak "s|^OPENVIKING_ROOT_KEY=.*|OPENVIKING_ROOT_KEY=$ROOT_KEY|" "$ENV_FILE"
      rm -f "${ENV_FILE}.bak"
    fi
  fi
else
  echo "[setup] Existing admin key found in $ENV_FILE, skipping mint"
fi

# ── Start all ───────────────────────────────────────────────
echo "[setup] Starting all services..."
docker compose up -d

echo -n "[setup] Waiting for server"
for i in $(seq 1 60); do
  curl -fsS "http://localhost:${PORT:-7777}/" >/dev/null 2>&1 && { echo " ready."; break; }
  [ "$i" -eq 60 ] && { echo " TIMEOUT"; docker compose logs --tail=10 server; exit 1; }
  echo -n "."; sleep 2
done

echo ""
echo "=== Done ==="
echo "  Zouk:       http://localhost:${PORT:-7777}"
echo "  Daemon:     zouk-daemon --server-url http://localhost:${PORT:-7777} --api-key test"
