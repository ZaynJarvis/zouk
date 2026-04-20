#!/usr/bin/env node

/**
 * zouk startup script
 * Starts the server (Express + WS on :7777) and web frontend (Vite on :5173) concurrently.
 * Usage: node bin/start.js [--server-only] [--web-only]
 */

const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVER_PORT = process.env.SERVER_PORT || 7777;
const WEB_PORT = process.env.WEB_PORT || 5173;
const args = process.argv.slice(2);
const serverOnly = args.includes("--server-only");
const webOnly = args.includes("--web-only");

const children = [];

function startProcess(name, command, cmdArgs, cwd, env = {}) {
  const proc = spawn(command, cmdArgs, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });

  const prefix = name.padEnd(8);

  proc.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.log(`[${prefix}] ${line}`);
    }
  });

  proc.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.error(`[${prefix}] ${line}`);
    }
  });

  proc.on("error", (err) => {
    console.error(`[${prefix}] Failed to start: ${err.message}`);
  });

  proc.on("exit", (code) => {
    console.log(`[${prefix}] Exited with code ${code}`);
  });

  children.push(proc);
  return proc;
}

console.log(`
╔══════════════════════════════════════════════╗
║               Zouk Local Dev                 ║
╠══════════════════════════════════════════════╣
║  Server:   http://localhost:${String(SERVER_PORT).padEnd(5)}              ║
║  Frontend: http://localhost:${String(WEB_PORT).padEnd(5)}              ║
║  Daemon:   ws://localhost:${String(SERVER_PORT).padEnd(5)}/daemon/connect  ║
╚══════════════════════════════════════════════╝

To connect a compatible daemon:
  # clone zouk-daemon first
  npx tsx src/index.ts --server-url http://localhost:${SERVER_PORT} --api-key test
`);

if (!webOnly) {
  startProcess(
    "server",
    "node",
    ["server/index.js"],
    ROOT,
    { PORT: String(SERVER_PORT) }
  );
}

if (!serverOnly) {
  // Give server a moment to start before launching frontend
  setTimeout(() => {
    startProcess(
      "web",
      "npx",
      ["vite", "--port", String(WEB_PORT), "--host"],
      path.join(ROOT, "web"),
      {}
    );
  }, webOnly ? 0 : 1000);
}

function cleanup() {
  console.log("\nShutting down...");
  for (const proc of children) {
    proc.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
