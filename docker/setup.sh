#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

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
    read -rp "  Embedding API key (VolcEngine): " EMB_KEY
    read -rp "  VLM API key (blank = same):     " VLM_KEY
  fi
  VLM_KEY="${VLM_KEY:-$EMB_KEY}"
  [ -z "$EMB_KEY" ] && { echo "ERROR: embedding key required."; exit 1; }

  # Generate OV root API key (static config value, no admin API needed)
  ROOT_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

  python3 -c "
import json
with open('docker/ov.conf.example') as f: c = json.load(f)
c['embedding']['dense']['api_key'] = '$EMB_KEY'
c['vlm']['api_key'] = '$VLM_KEY'
c['server']['auth_mode'] = 'api_key'
c['server']['root_api_key'] = '$ROOT_KEY'
with open('$OV_CONF', 'w') as f: json.dump(c, f, indent=4)
"
  # Write root key to .env for zouk-server
  sed -i.bak "s|^OPENVIKING_ROOT_KEY=.*|OPENVIKING_ROOT_KEY=$ROOT_KEY|" "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
  echo "[setup] Created $OV_CONF (api_key mode, root key in $ENV_FILE)"
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
