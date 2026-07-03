#!/usr/bin/env node
/**
 * Zouk eval runner — executes the full eval suite and prints a scorecard.
 *
 * Currently runs:
 *   1. eval-reply-storm.mjs  — send-freshness spam reduction (subprocess)
 *   2. daemon-e2e smoke      — real daemon connects, advertises mock runtime
 *
 * Exits nonzero when any eval fails its criteria.
 *
 * Usage: node server/eval-run.mjs [--agents N] [--policy llm-like|resend]
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZoukSimulation } from './test-support/zouk-simulation.mjs';
import {
  isRealDaemonAvailable,
  startRealDaemon,
} from './test-support/zouk-real-daemon.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { agents: 3, policy: 'llm-like' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agents') args.agents = parseInt(argv[++i], 10);
    else if (argv[i] === '--policy') args.policy = argv[++i];
  }
  return args;
}

// ── eval-reply-storm as subprocess ──────────────────────────────────────

function runReplyStormEval({ agents, policy }) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'eval-reply-storm.mjs');
    const proc = spawn(process.execPath, [script, '--agents', String(agents), '--policy', policy], {
      cwd: REPO_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('exit', (code) => {
      // Parse the summary line to extract numbers
      // "freshness ON reduced posted replies from 3 to 1 (spam score 2 -> 0), issuing 2 hold(s)."
      const summaryMatch = stdout.match(
        /freshness ON reduced posted replies from (\d+) to (\d+) \(spam score (\d+) -> (\d+)\), issuing (\d+) hold\(s\)\./,
      );

      let parsed = null;
      if (summaryMatch) {
        parsed = {
          offReplies: parseInt(summaryMatch[1], 10),
          onReplies: parseInt(summaryMatch[2], 10),
          offSpam: parseInt(summaryMatch[3], 10),
          onSpam: parseInt(summaryMatch[4], 10),
          holds: parseInt(summaryMatch[5], 10),
        };
      }

      resolve({
        name: 'reply-storm',
        exitCode: code,
        stdout,
        stderr,
        parsed,
        passed: code === 0 && parsed !== null && parsed.onSpam < parsed.offSpam,
      });
    });
  });
}

// ── daemon-e2e smoke test (in-process) ──────────────────────────────────

async function runDaemonSmoke() {
  const name = 'daemon-smoke';

  if (!isRealDaemonAvailable()) {
    return {
      name,
      skipped: true,
      reason: 'zouk-daemon binary not found (set ZOUK_DAEMON_BIN or build ../zouk-daemon)',
      passed: true, // skipped is not a failure
    };
  }

  let sim = null;
  let daemon = null;

  try {
    sim = await createZoukSimulation({ name: 'eval-daemon-smoke' });
    const key = await sim.createMachineKey('eval-daemon-smoke-machine');

    daemon = await startRealDaemon(sim, {
      machineKey: key.rawKey,
      hostname: 'eval-daemon-smoke',
      env: {
        ZOUK_DAEMON_AGENT_START_INTERVAL_MS: '0',
      },
    });

    const machine = await sim.waitForMachineReady(key.key.id, {
      runtime: 'mock',
      timeoutMs: 8000,
    });

    const passed = !!machine && machine.runtimes?.includes('mock');
    const detail = passed
      ? `machine ${key.key.id} ready with runtimes: ${machine.runtimes.join(', ')}`
      : 'machine did not appear with mock runtime';

    return {
      name,
      passed,
      detail,
      machineId: key.key.id,
      daemonStderr: daemon.stderr.slice(-2000),
    };
  } catch (err) {
    return {
      name,
      passed: false,
      error: err.message,
      daemonStderr: daemon?.stderr?.slice(-2000) || '',
    };
  } finally {
    if (daemon) {
      try { await daemon.stop(); } catch { /* ignore */ }
    }
    if (sim) {
      try { await sim.stop(); } catch { /* ignore */ }
    }
  }
}

// ── Scorecard ───────────────────────────────────────────────────────────

function printScorecard(results) {
  console.log('\n' + '='.repeat(64));
  console.log('ZOUK EVAL SCORECARD');
  console.log('='.repeat(64));

  for (const r of results) {
    const status = r.skipped ? 'SKIP' : (r.passed ? 'PASS' : 'FAIL');
    const icon = r.skipped ? '~' : (r.passed ? '+' : 'X');
    console.log(`  [${icon}] ${r.name}: ${status}`);
    if (r.skipped && r.reason) {
      console.log(`      reason: ${r.reason}`);
    }
    if (!r.passed && !r.skipped && r.detail) {
      console.log(`      detail: ${r.detail}`);
    }
    if (!r.passed && !r.skipped && r.error) {
      console.log(`      error: ${r.error}`);
    }
  }

  console.log('='.repeat(64));

  const total = results.filter((r) => !r.skipped).length;
  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`  Results: ${passed}/${total} passed, ${skipped} skipped`);
  console.log('='.repeat(64) + '\n');
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const { agents, policy } = parseArgs(process.argv.slice(2));
  console.log(`zouk eval runner — ${agents} agents, onHold policy=${policy}\n`);

  const results = [];

  // 1. Reply-storm eval
  console.log('--- eval 1: reply-storm ---');
  const stormResult = await runReplyStormEval({ agents, policy });
  if (stormResult.stdout) {
    // Print the storm's own output (table + summary)
    const lines = stormResult.stdout.trim().split('\n');
    for (const line of lines) console.log(`  ${line}`);
  }
  if (stormResult.stderr) {
    console.log(`  [stderr] ${stormResult.stderr.trim().split('\n').slice(-5).join('\n  ')}`);
  }
  results.push({
    name: 'reply-storm',
    passed: stormResult.passed,
    detail: stormResult.parsed
      ? `spam ${stormResult.parsed.offSpam} -> ${stormResult.parsed.onSpam}`
      : 'could not parse output',
  });

  // 2. Daemon smoke
  console.log('\n--- eval 2: daemon smoke ---');
  const daemonResult = await runDaemonSmoke();
  if (daemonResult.skipped) {
    console.log(`  SKIPPED: ${daemonResult.reason}`);
  } else if (daemonResult.passed) {
    console.log(`  PASS: ${daemonResult.detail}`);
  } else {
    console.log(`  FAIL: ${daemonResult.detail || daemonResult.error}`);
    if (daemonResult.daemonStderr) {
      console.log(`  daemon stderr:\n${daemonResult.daemonStderr.split('\n').map((l) => `    ${l}`).join('\n')}`);
    }
  }
  results.push(daemonResult);

  // Print scorecard
  printScorecard(results);

  const anyFailed = results.some((r) => !r.passed && !r.skipped);
  if (anyFailed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('eval runner error:', err);
  process.exitCode = 1;
});
