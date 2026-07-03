/**
 * Real-daemon harness for zouk-simulation e2e tests.
 *
 * Spawns the ACTUAL zouk-daemon binary (not the SimulatedDaemon websocket
 * helper) connected to a running ZoukSimulation. The daemon advertises the
 * "mock" runtime so agents can run without any LLM CLI installed.
 *
 * Usage:
 *   import { isRealDaemonAvailable, startRealDaemon, writeMockBehavior }
 *     from './test-support/zouk-real-daemon.mjs';
 *
 *   if (!isRealDaemonAvailable()) { t.skip('no daemon'); return; }
 *   const daemon = await startRealDaemon(sim, { machineKey: key.rawKey });
 *   await sim.waitForMachineReady(machineId, { runtime: 'mock' });
 *   // ... start agent, send messages, assert replies ...
 *   await daemon.stop();
 */

import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(SERVER_DIR, '..');

// ── Daemon binary resolution ────────────────────────────────────────────

/**
 * Find the main zouk checkout directory (not a worktree).
 * When running from a git worktree, resolves back to the primary clone so
 * the sibling zouk-daemon path is correct.
 */
function findMainCheckout() {
  try {
    const commonDir = execSync(
      'git rev-parse --git-common-dir',
      { cwd: REPO_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    // commonDir is the .git dir of the main checkout (or the worktree's shared .git)
    if (commonDir.endsWith('.git')) {
      return path.dirname(commonDir);
    }
    // For bare repos or worktrees, .git might be a file pointing to the real dir
    return path.resolve(REPO_DIR, commonDir, '..');
  } catch {
    return REPO_DIR;
  }
}

/**
 * Resolve the path to the zouk-daemon entry point.
 * Priority:
 *   1. ZOUK_DAEMON_BIN env var (absolute path to a .js file)
 *   2. Sibling checkout: ../zouk-daemon/dist/index.js relative to main zouk checkout
 *   3. zouk-daemon/dist/index.js anywhere in the zouk workspace
 * Returns null if nothing is found.
 */
export function resolveDaemonBin() {
  if (process.env.ZOUK_DAEMON_BIN) {
    const p = process.env.ZOUK_DAEMON_BIN;
    if (fs.existsSync(p)) return p;
    return null;
  }

  // Try relative to the main checkout (handles worktrees correctly)
  const mainCheckout = findMainCheckout();
  const candidates = [
    path.resolve(mainCheckout, '..', 'zouk-daemon', 'dist', 'index.js'),
    path.resolve(REPO_DIR, '..', 'zouk-daemon', 'dist', 'index.js'),
    // Also try the zouk workspace root (common local dev layout)
    path.resolve(REPO_DIR, '..', '..', 'zouk-daemon', 'dist', 'index.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Whether a usable zouk-daemon binary is available. Tests should call this
 * and skip (node:test `t.skip()`) when it returns false — CI has no daemon
 * checkout.
 */
export function isRealDaemonAvailable() {
  return resolveDaemonBin() !== null;
}

// ── Log capture ─────────────────────────────────────────────────────────

const MAX_LOG = 24_000;

function appendLog(current, chunk) {
  const next = current + chunk.toString();
  return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
}

// ── Process lifecycle ───────────────────────────────────────────────────

async function waitForExit(proc, timeoutMs) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return true;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    proc.once('exit', onExit);
  });
}

// ── Mock behavior helper ────────────────────────────────────────────────

/**
 * Write a mock-behavior.json into an agent's work directory.
 * Creates the directory if it doesn't exist.
 */
export function writeMockBehavior(workDir, behavior) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'mock-behavior.json'),
    JSON.stringify(behavior, null, 2),
    'utf8',
  );
}

// ── startRealDaemon ─────────────────────────────────────────────────────

/**
 * Spawn a real zouk-daemon connected to the given simulation.
 *
 * @param {object} sim - A running ZoukSimulation instance (needs .wsUrl).
 * @param {object} options
 * @param {string} options.machineKey - The raw machine API key (from sim.createMachineKey()).
 * @param {string} [options.dataDir] - Override daemon data dir (default: temp dir).
 * @param {object} [options.env] - Additional env vars to merge.
 * @param {string} [options.hostname] - Override hostname reported by the daemon.
 * @returns {Promise<{stop: function, stdout: string, stderr: string, dataDir: string}>}
 */
export async function startRealDaemon(sim, options = {}) {
  const bin = resolveDaemonBin();
  if (!bin) {
    throw new Error(
      'zouk-daemon binary not found. Set ZOUK_DAEMON_BIN or ensure '
      + '../zouk-daemon/dist/index.js exists (build the daemon first).',
    );
  }

  const dataDir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'zouk-daemon-data-'));
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    ZOUK_MOCK_RUNTIME: '1',
    ZOUK_DISABLE_AUTO_UPDATE: '1',
    ZOUK_WRITE_OVCLI_CONF: '0',
    FORCE_COLOR: '0',
    ...(options.env || {}),
  };

  const args = [
    bin,
    '--server-url', sim.wsUrl,
    '--api-key', options.machineKey,
    '--data-dir', dataDir,
    '--no-ovcli-conf',
  ];

  if (options.hostname) {
    args.push('--hostname', options.hostname);
  }

  // Run from the daemon repo root so the mock driver can resolve
  // dist/mock-runtime.js and dist/agent-mcp.js via its cwdDist fallback.
  const daemonCwd = path.dirname(path.dirname(bin));

  const proc = spawn(process.execPath, args, {
    cwd: daemonCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (chunk) => { stdout = appendLog(stdout, chunk); });
  proc.stderr.on('data', (chunk) => { stderr = appendLog(stderr, chunk); });

  // Give the daemon a moment to fail fast (e.g. bad import, missing dep).
  // We don't wait for ready here — the caller uses sim.waitForMachineReady.
  await new Promise((resolve) => setTimeout(resolve, 200));

  if (proc.exitCode !== null) {
    throw new Error(
      `zouk-daemon exited early with code ${proc.exitCode}\n`
      + `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
    );
  }

  return {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    dataDir,
    pid: proc.pid,

    async stop({ timeoutMs = 5000 } = {}) {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      proc.kill('SIGTERM');
      const exited = await waitForExit(proc, timeoutMs - 1000);
      if (!exited && proc.exitCode === null && proc.signalCode === null) {
        proc.kill('SIGKILL');
        await waitForExit(proc, 1000);
      }
      // Clean up temp data dir unless caller provided their own
      if (!options.dataDir) {
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    },
  };
}
