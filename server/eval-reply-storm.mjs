#!/usr/bin/env node
// Reply-storm eval: measures how much the send-freshness optimistic lock
// (server/routes/agent-internal.js POST /:agentId/send) cuts down redundant
// multi-agent replies to a single human question.
//
// Scenario: one human question lands in #all with N scripted agents
// subscribed. All N get the fan-out delivery (channels with <4 agents fan
// out to everyone — see server/notifications/agentDeliveryRouter.js) and
// each schedules a reply after a staggered "thinking" delay. Without the
// freshness check, all N reply. With it, only the first reply lands — the
// rest see it was already answered and either skip (llm-like policy) or
// hold-then-resend into a second hold (resend policy).
//
// Runs the scenario twice — freshness ON (default) and OFF
// (ZOUK_SEND_FRESHNESS=0) — against a fresh sim each time, and prints a
// compact comparison.
//
// Usage: node server/eval-reply-storm.mjs [--agents N] [--policy llm-like|resend]

import { createZoukSimulation } from './test-support/zouk-simulation.mjs';
import { createScriptedAgent } from './test-support/zouk-scripted-agents.mjs';

const REPLY_DELAYS_MS = [400, 800, 1200, 1600, 2000, 2400];
const SETTLE_MS = 3800;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = { agents: 3, policy: 'llm-like' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agents') args.agents = parseInt(argv[++i], 10);
    else if (argv[i] === '--policy') args.policy = argv[++i];
  }
  if (!Number.isFinite(args.agents) || args.agents < 1) {
    throw new Error('--agents must be a positive integer');
  }
  if (!['llm-like', 'resend'].includes(args.policy)) {
    throw new Error('--policy must be "llm-like" or "resend"');
  }
  return args;
}

async function runScenario({ label, slug, agentCount, policy, env }) {
  const sim = await createZoukSimulation({ name: `eval-reply-storm-${slug}`, env });
  try {
    const key = await sim.createMachineKey(`reply-storm-machine-${slug}`);
    const daemon = await sim.connectDaemon({ key: key.rawKey });
    daemon.ready({ runtimes: ['claude'], capabilities: [] });
    await sim.waitForMachineReady(key.key.id, { runtime: 'claude' });

    const agents = [];
    for (let i = 0; i < agentCount; i++) {
      // eslint-disable-next-line no-await-in-loop
      const agent = await createScriptedAgent(sim, daemon, {
        name: `storm-bot-${i + 1}-${slug}`,
        machineId: key.key.id,
        channel: '#all',
        replyDelayMs: REPLY_DELAYS_MS[i] ?? 400 * (i + 1),
        onHold: policy,
        // Only answer the human's question — like a real LLM-driven agent,
        // don't jump in on every reply the small-channel fan-out redelivers
        // (that's the "spam" the freshness check exists to cut down, not
        // reply-to-a-reply chatter this eval isn't measuring).
        buildReply: (message) => (message.sender_type === 'agent' ? null : `ack from bot ${i + 1}: re "${message.content}"`),
      });
      agents.push(agent);
    }

    const human = await sim.createGuest(`reply-storm-human-${slug}-${Date.now()}`);
    const question = `[reply-storm ${label}] anyone free to help with the deploy?`;
    await sim.sendHumanMessage({ token: human.token, target: '#all', content: question });

    await sleep(SETTLE_MS);

    const history = await sim.getMessages({ channel: '#all', limit: 100 });
    const agentReplies = history.messages.filter((m) => m.senderType === 'agent');

    const totals = agents.reduce((acc, a) => {
      acc.sends += a.counters.sends;
      acc.held += a.counters.held;
      acc.skipped += a.counters.skipped;
      acc.posted += a.counters.posted;
      return acc;
    }, { sends: 0, held: 0, skipped: 0, posted: 0 });

    for (const agent of agents) agent.stop();

    return {
      label,
      postedReplies: agentReplies.length,
      spamScore: Math.max(0, agentReplies.length - 1),
      ...totals,
    };
  } finally {
    await sim.stop();
  }
}

function printTable(rows) {
  const cols = ['label', 'postedReplies', 'held', 'skipped', 'sends', 'spamScore'];
  const headers = { label: 'freshness', postedReplies: 'posted replies', held: 'holds issued', skipped: 'skipped (redundant)', sends: 'send attempts', spamScore: 'spam score' };
  const widths = cols.map((c) => Math.max(headers[c].length, ...rows.map((r) => String(r[c]).length)));
  const fmt = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  |  ');
  console.log(fmt(cols.map((c) => headers[c])));
  console.log(widths.map((w) => '-'.repeat(w)).join('--+--'));
  for (const row of rows) console.log(fmt(cols.map((c) => row[c])));
}

async function main() {
  const { agents, policy } = parseArgs(process.argv.slice(2));
  console.log(`reply-storm eval — ${agents} agents, onHold policy=${policy}\n`);

  const on = await runScenario({ label: 'ON', slug: 'on', agentCount: agents, policy, env: {} });
  const off = await runScenario({ label: 'OFF (ZOUK_SEND_FRESHNESS=0)', slug: 'off', agentCount: agents, policy, env: { ZOUK_SEND_FRESHNESS: '0' } });

  printTable([on, off]);

  console.log(
    `\nfreshness ON reduced posted replies from ${off.postedReplies} to ${on.postedReplies} `
    + `(spam score ${off.spamScore} -> ${on.spamScore}), issuing ${on.held} hold(s).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
