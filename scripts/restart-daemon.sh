#!/usr/bin/env bash
# Restart the zouk daemon reliably.
#
# Strategy:
#   - If the daemon runs inside a tmux pane: Ctrl+C to stop, re-run the same
#     command in the same pane (preserves shell env, --tui, history).
#   - If the daemon runs standalone (nohup): SIGTERM → SIGKILL, then nohup restart.
#   - If multiple daemons are running: list them with server URLs and exit with
#     instructions — set SERVER_URL=<url> to target a specific one.
#
# Usage:
#   bash scripts/restart-daemon.sh
#   SERVER_URL=https://zouki.zaynjarvis.com bash scripts/restart-daemon.sh
#
# Env overrides:
#   SERVER_URL    — target a specific daemon when multiple are running
#   DAEMON_DIR    — override auto-detected zouk-daemon path
#   NODE          — override auto-detected node binary
#   LOG_FILE      — nohup log path (default: /tmp/zouk-daemon.log)
#   PID_FILE      — nohup PID file path (default: /tmp/zouk-daemon.pid)
#   STOP_TIMEOUT  — seconds to wait for graceful shutdown (default: 10)
#   STARTUP_TIMEOUT — seconds to wait for connection (default: 30)

set -uo pipefail

die() { echo "[restart] ERROR: $*" >&2; exit 1; }
log() { echo "[restart] $*"; }

# ── Auto-detect DAEMON_DIR ────────────────────────────────────────────────────
DAEMON_DIR="${DAEMON_DIR:-}"
if [ -z "$DAEMON_DIR" ]; then
  for d in \
    "$HOME/code/c/zouk-daemon" \
    "/Users/lululiang/code/c/zouk-daemon"; do
    if [ -f "$d/src/index.ts" ]; then
      DAEMON_DIR="$d"
      break
    fi
  done
fi
[ -z "$DAEMON_DIR" ] && die "Cannot find zouk-daemon directory. Set DAEMON_DIR=/path/to/zouk-daemon."

NODE="${NODE:-$(which node 2>/dev/null || true)}"
[ -z "$NODE" ] && die "Cannot find node binary. Set NODE=/path/to/node."

TSX_PREFLIGHT="$DAEMON_DIR/node_modules/tsx/dist/preflight.cjs"
TSX_LOADER="file://$DAEMON_DIR/node_modules/tsx/dist/loader.mjs"
ENTRY="$DAEMON_DIR/src/index.ts"
LOG_FILE="${LOG_FILE:-/tmp/zouk-daemon.log}"
PID_FILE="${PID_FILE:-/tmp/zouk-daemon.pid}"
STOP_TIMEOUT="${STOP_TIMEOUT:-10}"
STARTUP_TIMEOUT="${STARTUP_TIMEOUT:-30}"

log "DAEMON_DIR: $DAEMON_DIR"
log "NODE: $NODE"

# ── Find running daemon(s) ────────────────────────────────────────────────────
# Returns "PID server-url" lines for all running daemons.
find_daemons() {
  ps -axww -o pid= -o args= \
    | awk '/src\/index\.ts/ && /server-url/ && !/awk/ {
        pid = $1
        url = ""
        for (i = 2; i <= NF; i++) {
          if ($i == "--server-url" && i+1 <= NF) { url = $(i+1); break }
        }
        print pid, url
      }'
}

ALL_DAEMONS=$(find_daemons || true)
DAEMON_COUNT=$(echo "$ALL_DAEMONS" | awk 'NF>0' | wc -l | tr -d ' ')

TARGET_URL="${SERVER_URL:-}"

if [ "$DAEMON_COUNT" -eq 0 ] || [ -z "$ALL_DAEMONS" ]; then
  log "No running daemon found — starting fresh."
  DAEMON_COUNT=0
  OLD_PID=""
  OLD_ARGS=""
elif [ "$DAEMON_COUNT" -eq 1 ]; then
  OLD_PID=$(echo "$ALL_DAEMONS" | awk '{print $1}')
  DETECTED_URL=$(echo "$ALL_DAEMONS" | awk '{print $2}')
  OLD_ARGS=$(ps -p "$OLD_PID" -o args= 2>/dev/null) || die "Cannot read args for PID $OLD_PID"
  log "Found daemon: PID $OLD_PID  server-url: $DETECTED_URL"
  # If user specified a SERVER_URL, verify it matches
  if [ -n "$TARGET_URL" ] && [ "$TARGET_URL" != "$DETECTED_URL" ]; then
    die "Running daemon ($DETECTED_URL) does not match requested SERVER_URL ($TARGET_URL). Is the right daemon running?"
  fi
  TARGET_URL="$DETECTED_URL"
else
  # Multiple daemons — require explicit SERVER_URL
  echo ""
  echo "[restart] MULTIPLE DAEMONS DETECTED — human confirmation required."
  echo "[restart] Running daemons:"
  echo "$ALL_DAEMONS" | while read -r pid url; do
    echo "  PID $pid  →  $url"
  done
  echo ""
  if [ -z "$TARGET_URL" ]; then
    echo "[restart] Set SERVER_URL=<url> to target a specific daemon, then re-run."
    exit 1
  fi
  # Pick the one matching TARGET_URL
  MATCH=$(echo "$ALL_DAEMONS" | awk -v url="$TARGET_URL" '$2 == url {print $1}')
  [ -z "$MATCH" ] && die "No daemon found for SERVER_URL=$TARGET_URL"
  OLD_PID="$MATCH"
  OLD_ARGS=$(ps -p "$OLD_PID" -o args= 2>/dev/null) || die "Cannot read args for PID $OLD_PID"
  log "Targeting PID $OLD_PID ($TARGET_URL)"
fi

# ── Extract all original flags (preserve --tui, --metrics-port, etc.) ─────────
if [ -n "${OLD_ARGS:-}" ]; then
  SERVER_URL=$(echo "$OLD_ARGS" | awk '{for(i=1;i<=NF;i++) if($i=="--server-url") {print $(i+1); exit}}')
  API_KEY=$(echo "$OLD_ARGS"    | awk '{for(i=1;i<=NF;i++) if($i=="--api-key")    {print $(i+1); exit}}')
  # Extra flags: everything after --api-key value (strip the entry path and core flags)
  EXTRA_FLAGS=$(echo "$OLD_ARGS" \
    | sed "s|$ENTRY||" \
    | sed 's/--server-url [^ ]*//g' \
    | sed 's/--api-key [^ ]*//g' \
    | sed 's/[^ ]*node[^ ]*//g' \
    | sed 's/--require [^ ]*//g' \
    | sed 's/--import [^ ]*//g' \
    | tr -s ' ' | sed 's/^ //;s/ $//')
  [ -z "$SERVER_URL" ] && die "Could not extract --server-url from PID $OLD_PID"
  [ -z "$API_KEY" ]    && die "Could not extract --api-key from PID $OLD_PID"
else
  # Cold start — read from env file
  ENV_FILE="$HOME/.zouk-daemon.env"
  if [ -f "$ENV_FILE" ]; then
    set -a; source "$ENV_FILE"; set +a
    log "Loaded config from $ENV_FILE"
  fi
  SERVER_URL="${ZOUK_SERVER_URL:-}"
  API_KEY="${ZOUK_API_KEY:-}"
  EXTRA_FLAGS="${ZOUK_EXTRA_FLAGS:-}"
  [ -z "$SERVER_URL" ] && die "No running daemon and ZOUK_SERVER_URL not set. Add to $ENV_FILE."
  [ -z "$API_KEY" ]    && die "No running daemon and ZOUK_API_KEY not set. Add to $ENV_FILE."
fi

log "server-url: $SERVER_URL"

# ── Detect if daemon is running in a tmux pane ────────────────────────────────
get_tmux_pane_for_daemon() {
  local daemon_pid=$1
  local pane_list
  pane_list=$(tmux list-panes -a -F "#{pane_pid} #{pane_id}" 2>/dev/null) || return 1
  # Walk up the parent chain from daemon_pid; any match is a tmux pane shell
  local pid="$daemon_pid"
  while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
    local match
    match=$(echo "$pane_list" | awk -v p="$pid" '$1 == p {print $2}')
    if [ -n "$match" ]; then
      echo "$match"
      return 0
    fi
    pid=$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')
  done
  return 1
}

# Get the command to re-run (relative to DAEMON_DIR)
# We reconstruct it as: npx tsx src/index.ts <original flags>
RESTART_CMD="npx tsx src/index.ts --server-url $SERVER_URL --api-key $API_KEY${EXTRA_FLAGS:+ $EXTRA_FLAGS}"

TMUX_PANE=""
DAEMON_IN_TMUX=false  # true only if daemon itself is the foreground process in TMUX_PANE
if command -v tmux &>/dev/null && tmux info &>/dev/null 2>&1; then
  if [ -n "${OLD_PID:-}" ]; then
    # Try: is the daemon a descendant of a tmux pane (foreground in tmux)?
    TMUX_PANE=$(get_tmux_pane_for_daemon "$OLD_PID" 2>/dev/null || true)
    [ -n "$TMUX_PANE" ] && DAEMON_IN_TMUX=true
  fi
  if [ -z "$TMUX_PANE" ]; then
    # Fallback: find an idle pane in a session named "zouk-daemon" to restart in.
    # Daemon will be stopped via SIGTERM (it's not running in this pane).
    TMUX_PANE=$(tmux list-panes -a \
      -F "#{session_name} #{pane_id} #{pane_current_command}" 2>/dev/null \
      | awk '/zouk-daemon/ && /zsh|bash/ {print $2; exit}' || true)
    [ -n "$TMUX_PANE" ] && log "Will restart in zouk-daemon tmux pane $TMUX_PANE (daemon currently nohup)"
  fi
fi

# ── Stop old daemon ───────────────────────────────────────────────────────────
if [ -n "${OLD_PID:-}" ]; then
  STOPPED=false
  if [ "$DAEMON_IN_TMUX" = "true" ]; then
    # Daemon is the foreground process in the tmux pane — Ctrl+C is cleanest
    log "Daemon running in tmux pane $TMUX_PANE — sending Ctrl+C..."
    tmux send-keys -t "$TMUX_PANE" C-c 2>/dev/null || true
  else
    log "Sending SIGTERM to PID $OLD_PID..."
    kill -TERM "$OLD_PID"
  fi
  for i in $(seq 1 $STOP_TIMEOUT); do
    if ! kill -0 "$OLD_PID" 2>/dev/null; then
      log "Stopped after ${i}s."
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

# ── Start new daemon ──────────────────────────────────────────────────────────
if [ -n "$TMUX_PANE" ]; then
  # Restart inside the same tmux pane (preserves TUI, env, shell history)
  log "Restarting inside tmux pane $TMUX_PANE..."
  tmux send-keys -t "$TMUX_PANE" "cd $DAEMON_DIR && $RESTART_CMD" Enter
  # Poll tmux pane output for connected message
  log "Waiting for connection (up to ${STARTUP_TIMEOUT}s)..."
  for i in $(seq 1 $STARTUP_TIMEOUT); do
    if tmux capture-pane -t "$TMUX_PANE" -p 2>/dev/null | grep -q "\[Daemon\] Connected to server"; then
      log "Connected after ${i}s. Daemon live in pane $TMUX_PANE."
      exit 0
    fi
    sleep 1
  done
  log "Timed out. Recent pane output:"
  tmux capture-pane -t "$TMUX_PANE" -p 2>/dev/null | tail -15
  die "Daemon started in pane $TMUX_PANE but did not connect within ${STARTUP_TIMEOUT}s."
else
  # Standalone nohup restart
  log "Starting new daemon with nohup..."
  { echo ""; echo "=== restart $(date) ==="; } >> "$LOG_FILE"
  LOG_OFFSET=$(wc -l < "$LOG_FILE")
  nohup "$NODE" \
    --require "$TSX_PREFLIGHT" \
    --import  "$TSX_LOADER"    \
    "$ENTRY"                   \
    --server-url "$SERVER_URL" \
    --api-key    "$API_KEY"    \
    ${EXTRA_FLAGS:+$EXTRA_FLAGS} \
    >> "$LOG_FILE" 2>&1 &
  # Find the actual node PID (nohup spawns a subshell; ps is more reliable than $!)
  sleep 1
  NEW_PID=$(ps -axww -o pid= -o args= \
    | awk '/src\/index\.ts/ && /server-url/ && !/awk/' \
    | awk '{print $1}' | head -1 || true)
  if [ -z "$NEW_PID" ]; then
    log "Process not found 1s after launch. Recent log:"
    tail -20 "$LOG_FILE"
    die "Daemon did not start."
  fi
  log "New daemon PID: $NEW_PID"
  echo "$NEW_PID" > "$PID_FILE"
  # Poll log for connection
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
  log "Timed out. Recent log:"
  tail -15 "$LOG_FILE"
  die "Daemon started (PID $NEW_PID) but did not connect within ${STARTUP_TIMEOUT}s."
fi
