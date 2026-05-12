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
  npm install --omit=dev --omit=optional --no-audit --no-fund
)

# Sanity check: server entrypoint must resolve its requires before TCE
# tries to boot. Failing here surfaces a missing-prod-dep at SCM time
# rather than at TCE rollout time.
echo "[build] verifying server entry resolves"
( cd "${OUT}" && node --check server/index.js )

cat > "${OUT}/bootstrap.sh" <<'EOF'
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export NODE_ENV="${NODE_ENV:-production}"
exec node server/index.js
EOF
chmod +x "${OUT}/bootstrap.sh"

echo "[build] done. artifact at ./${OUT}/"
ls -lh "${OUT}/"
