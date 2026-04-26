#!/usr/bin/env bash
# Restart the zouk daemon reliably with nohup.
#
# Strategy: stop old first (avoid dual-connection), then start new.
# Waits for "[Daemon] Connected to server" in log before declaring success.
#
# Usage:
#   bash scripts/restart-daemon.sh

set -uo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
DAEMON_DIR="/Users/lululiang/code/c/zouk-daemon"
NODE="/opt/homebrew/Cellar/node@22/22.22.0/bin/node"
TSX_PREFLIGHT="$DAEMON_DIR/node_modules/tsx/dist/preflight.cjs"
TSX_LOADER="file://$DAEMON_DIR/node_modules/tsx/dist/loader.mjs"
ENTRY="$DAEMON_DIR/src/index.ts"
LOG_FILE="/tmp/zouk-daemon.log"
PID_FILE="/tmp/zouk-daemon.pid"
STOP_TIMEOUT=10     # seconds to wait for graceful shutdown
STARTUP_TIMEOUT=30  # seconds to wait for "Connected to server"
# ─────────────────────────────────────────────────────────────────────────────

die() { echo "[restart] ERROR: $*" >&2; exit 1; }
log() { echo "[restart] $*"; }

# macOS pgrep -f silently skips orphaned processes (PPID=1, nohup-launched).
# Use ps instead, which always shows them.
find_daemon_pid() {
  ps -axo pid= -o args= | grep "zouk-daemon/src/index.ts" | grep -v grep | awk '{print $1}' | head -1
}

# 1. Find running daemon
OLD_PID=$(find_daemon_pid || true)

if [ -z "$OLD_PID" ]; then
  log "No running daemon found — starting fresh."
  # Load from ~/.zouk-daemon.env if env vars not already set
  ENV_FILE="$HOME/.zouk-daemon.env"
  if [ -f "$ENV_FILE" ]; then
    # shellcheck source=/dev/null
    set -a; source "$ENV_FILE"; set +a
    log "Loaded config from $ENV_FILE"
  fi
  SERVER_URL="${ZOUK_SERVER_URL:-}"
  API_KEY="${ZOUK_API_KEY:-}"
  [ -z "$SERVER_URL" ] && die "No running daemon and ZOUK_SERVER_URL not set (set env or add to $ENV_FILE)."
  [ -z "$API_KEY" ]    && die "No running daemon and ZOUK_API_KEY not set (set env or add to $ENV_FILE)."
else
  log "Found running daemon: PID $OLD_PID"

  # 2. Extract connection args from live process before stopping it
  OLD_ARGS=$(ps -p "$OLD_PID" -o args= 2>/dev/null) || die "Cannot read args for PID $OLD_PID"
  SERVER_URL=$(echo "$OLD_ARGS" | grep -oE '\-\-server-url [^ ]+' | awk '{print $2}')
  API_KEY=$(echo "$OLD_ARGS"    | grep -oE '\-\-api-key [^ ]+'    | awk '{print $2}')
  [ -z "$SERVER_URL" ] && die "Could not extract --server-url from PID $OLD_PID"
  [ -z "$API_KEY" ]    && die "Could not extract --api-key from PID $OLD_PID"
  log "server-url: $SERVER_URL"

  # 3. Graceful stop
  log "Sending SIGTERM to PID $OLD_PID..."
  kill -TERM "$OLD_PID"
  STOPPED=false
  for i in $(seq 1 $STOP_TIMEOUT); do
    if ! kill -0 "$OLD_PID" 2>/dev/null; then
      log "Old daemon stopped after ${i}s."
      STOPPED=true
      break
    fi
    sleep 1
  done
  if [ "$STOPPED" != "true" ]; then
    log "Still alive after ${STOP_TIMEOUT}s — sending SIGKILL..."
    kill -KILL "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
fi

# 4. Start new daemon, appending to log
log "Starting new daemon with nohup..."
{ echo ""; echo "=== restart $(date) ==="; } >> "$LOG_FILE"
LOG_OFFSET=$(wc -l < "$LOG_FILE")

nohup "$NODE" \
  --require "$TSX_PREFLIGHT" \
  --import  "$TSX_LOADER"    \
  "$ENTRY"                   \
  --server-url "$SERVER_URL" \
  --api-key    "$API_KEY"    \
  >> "$LOG_FILE" 2>&1 &

# 5. Locate real node PID ($! is the nohup shell; use ps to find the actual node process)
sleep 1
NEW_PID=$(find_daemon_pid || true)
if [ -z "$NEW_PID" ]; then
  log "Process not found 1s after launch. Recent log:"
  tail -20 "$LOG_FILE"
  die "Daemon did not start."
fi
log "New daemon PID: $NEW_PID"
echo "$NEW_PID" > "$PID_FILE"

# 6. Poll log for successful connection
log "Waiting for connection (up to ${STARTUP_TIMEOUT}s)..."
for i in $(seq 1 $STARTUP_TIMEOUT); do
  if tail -n +"$((LOG_OFFSET + 1))" "$LOG_FILE" 2>/dev/null | grep -q "\[Daemon\] Connected to server"; then
    log "Connected after ${i}s. Daemon (PID $NEW_PID) is live."
    log "Log: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    log "Daemon (PID $NEW_PID) crashed during startup. Recent log:"
    tail -20 "$LOG_FILE"
    die "Daemon died before connecting."
  fi
  sleep 1
done

log "Timed out waiting for connection. Recent log:"
tail -20 "$LOG_FILE"
die "Daemon started (PID $NEW_PID) but did not connect within ${STARTUP_TIMEOUT}s."
