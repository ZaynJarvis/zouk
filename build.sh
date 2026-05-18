#!/usr/bin/env bash
# SCM build entrypoint for ByteDance internal deployment.
#
# Produces a self-contained artifact at ./output/ that the SCM platform
# uploads to ICM. TCE invokes ./output/bootstrap.sh as the container start
# command. The artifact contains:
#
#   output/server/         backend source (tests stripped)
#   output/web/dist/       prebuilt frontend (Vite)
#   output/node_modules/   prod-only deps (hoisted)
#   output/server/...      server workspace deps (resolved by npm)
#   output/schema.sql      PostgreSQL schema (run by server/db.js migrate)
#   output/package.json    trimmed manifest (web workspace removed)
#   output/bootstrap.sh    TCE start command
#
# Required runtime env vars on TCE (see docs/internal-deploy.md):
#   PORT             listen port (TCE injects, falls back to 7777)
#   PUBLIC_URL       external base URL (used for OAuth callbacks)
#   DATABASE_URL     internal PostgreSQL connection string
#   ALLOW            comma-separated email allowlist (optional)
# Optional (deferred to Feishu-SSO milestone):
#   GOOGLE_CLIENT_ID, SUPABASE_*, OPENVIKING_URL, OPENVIKING_ROOT_KEY

set -euo pipefail

cd "$(dirname "$0")"

# Internal npm mirror; override with NPM_REGISTRY=... when running outside
# the intranet (e.g. local smoke test).
: "${NPM_REGISTRY:=https://bnpm.byted.org/}"
export npm_config_registry="${NPM_REGISTRY}"

echo "[build] node=$(node -v) npm=$(npm -v) registry=${NPM_REGISTRY}"

echo "[build] installing root + workspace deps (incl. dev for Vite)"
npm ci --include=dev

echo "[build] building web frontend"
npm run build --workspace=web

OUT="output"
rm -rf "${OUT}"
mkdir -p "${OUT}/web"

echo "[build] staging artifact in ${OUT}/"
cp package.json schema.sql "${OUT}/"
cp -R server "${OUT}/server"
cp -R web/dist "${OUT}/web/dist"

# Drop test files from the artifact — TCE never runs them.
rm -f "${OUT}"/server/test-*.mjs
rm -rf "${OUT}"/server/notifications/__tests__

# Trim the root manifest: keep only the server workspace (web is shipped
# as prebuilt dist, no runtime resolution needed) and drop devDependencies
# so a fresh install in output/ produces a prod-only tree.
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("output/package.json", "utf8"));
  p.workspaces = ["server"];
  delete p.devDependencies;
  delete p.scripts.dev;
  delete p.scripts["web:dev"];
  delete p.scripts.build;
  delete p.scripts["test:server"];
  delete p.scripts["test:ui"];
  delete p.scripts.test;
  fs.writeFileSync("output/package.json", JSON.stringify(p, null, 2));
'

echo "[build] installing prod-only deps in ${OUT}/"
(
  cd "${OUT}"
  # NB: do NOT pass --omit=optional. sharp ships its platform-specific
  # native binary (e.g. @img/sharp-linux-x64) via optionalDependencies;
  # omitting them yields a runtime "Could not load the sharp module" on
  # boot.
  npm install --omit=dev --no-audit --no-fund
)

# Sanity check: server entrypoint must resolve its requires before TCE
# tries to boot. Failing here surfaces a missing-prod-dep at SCM time
# rather than at TCE rollout time.
echo "[build] verifying server entry resolves"
( cd "${OUT}" && node --check server/index.js )

cat > "${OUT}/bootstrap.sh" <<'EOF'
#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
export NODE_ENV="${NODE_ENV:-production}"

# TCE injects PORT as the dynamic *host-side* port when primary port is set,
# so a naive `process.env.PORT || 7777` would make the app listen on the
# wrong port and miss all forwarded traffic. Pin the in-container listen
# port here; override with ZOUK_PORT if you really need to change it.
export PORT="${ZOUK_PORT:-7777}"

# Tee stdout/stderr to a file inside the pod so `tail -f` from TCE webshell
# works, while keeping the original stream live for TCE's external log
# collector. Fall back to /tmp if /opt/tiger isn't writable on this image.
LOG_DIR="${ZOUK_LOG_DIR:-/opt/tiger/zouk/log}"
if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_DIR="/tmp/zouk"
  mkdir -p "$LOG_DIR"
fi
LOG_FILE="$LOG_DIR/server.log"
echo "[bootstrap] PORT=$PORT  log=$LOG_FILE"

exec node server/index.js > >(tee -a "$LOG_FILE") 2>&1
EOF
chmod +x "${OUT}/bootstrap.sh"

echo "[build] done. artifact at ./${OUT}/"
ls -lh "${OUT}/"
