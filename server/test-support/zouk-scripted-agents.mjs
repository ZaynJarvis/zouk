// Scripted agents for the reply-storm eval and freshness tests.
//
// A scripted agent behaves like a daemon running a fast LLM: when idle, it
// acks an `agent:deliver` frame the moment it arrives, waits `replyDelayMs`
// to simulate "thinking", then posts a reply. While that turn is in flight
// it is *not* idle, so any further deliveries queue up unacked until the
// turn finishes — same as a real daemon, which can't advance an agent's
// seen-cursor for messages the model hasn't actually looked at yet. This is
// what lets the send-freshness optimistic lock actually observe staleness:
// an agent that acked every delivery instantly, regardless of what turn it
// was mid-way through, would always be caught up and never get held. It
// exists purely to exercise that lock under multi-agent fan-out — it does
// not run a real runtime/daemon process.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHash(channel) {
  return channel.startsWith('#') ? channel.slice(1) : channel;
}

// createScriptedAgent(sim, daemon, opts) registers an agent config, subscribes
// it to `channel`, starts it on the shared `daemon` connection, and marks it
// active. It then runs a background loop for the lifetime of the daemon
// connection: every agent:deliver for this agent is acked immediately, then
// (after replyDelayMs) answered via sim.agentSend.
//
// Multiple scripted agents can share one SimulatedDaemon connection — start
// frames and deliveries are addressed by agentId, so one socket is enough.
export async function createScriptedAgent(sim, daemon, {
  name,
  machineId,
  channel = '#all',
  replyDelayMs = 500,
  buildReply,
  onHold = 'llm-like',
} = {}) {
  if (typeof buildReply !== 'function') {
    throw new Error('createScriptedAgent requires a buildReply(message) => string callback');
  }
  if (!['llm-like', 'resend'].includes(onHold)) {
    throw new Error(`createScriptedAgent: unknown onHold policy "${onHold}"`);
  }

  const agentId = `agent-${name}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 6)}`;

  await sim.createAgentConfig({ id: agentId, name, displayName: name, machineId });
  await sim.setAgentSubscription(agentId, { channelName: stripHash(channel), canRead: true, subscribed: true });

  const startFramePromise = daemon.waitForStart(agentId);
  await sim.startAgent({ agentId, name, displayName: name, machineId });
  await startFramePromise;

  daemon.agentStatus(agentId, { status: 'active' });
  await sim.waitUntil(async () => {
    const { agents } = await sim.get(`/internal/agent/${encodeURIComponent(agentId)}/server`);
    return agents.find((a) => a.name === name && a.status === 'active');
  }, `${name} active`, 2000);

  // Drain any pre-existing backlog, same as a freshly-onboarded agent would —
  // harmless no-op when the channel is empty, but keeps the seen-cursor
  // state consistent with a real agent's first check_messages call.
  await sim.agentReceive(agentId);

  const counters = { sends: 0, held: 0, skipped: 0, posted: 0 };
  let stopped = false;
  // A real daemon can only ack a delivery once its model turn is idle again
  // — while it's mid-turn (thinking/replying to an earlier delivery), new
  // deliveries queue up unacked. `busy` tracks whether we're mid-turn;
  // `pendingAck` remembers the newest not-yet-acked delivery to flush once
  // we go idle again.
  let busy = false;
  let pendingAck = null;

  async function attemptSend(content) {
    const result = await sim.agentSend(agentId, { target: channel, content });
    counters.sends++;
    return result;
  }

  async function handleDelivery(event) {
    busy = true;
    // Ack the delivery that started this turn now — this is what advances
    // the server's per-scope seen cursor for this agent.
    daemon.deliverAck(agentId, event.seq, event.cursor);

    await sleep(replyDelayMs);
    if (!stopped) {
      // buildReply may return a falsy value to mean "no reply needed" —
      // e.g. an LLM-like agent that only answers humans, not every agent
      // chatter the small-channel fan-out redelivers to it.
      const content = buildReply(event.message);
      if (content) {
        const first = await attemptSend(content);
        if (first.state !== 'held') {
          counters.posted++;
        } else {
          counters.held++;
          const redundant = onHold === 'llm-like'
            && (first.heldMessages || []).some((m) => m.sender_type === 'agent');
          if (redundant) {
            counters.skipped++;
          } else {
            // Re-send once — the held response already advanced our seen
            // cursor to seenUpToSeq, so this considered retry passes unless
            // even newer messages landed in the meantime.
            const second = await attemptSend(content);
            if (second.state === 'held') {
              counters.held++;
            } else {
              counters.posted++;
            }
          }
        }
      }
    }

    busy = false;
    if (pendingAck) {
      const toAck = pendingAck;
      pendingAck = null;
      daemon.deliverAck(agentId, toAck.seq, toAck.cursor);
    }
  }

  (async () => {
    while (!stopped) {
      let event;
      try {
        event = await daemon.waitForDelivery(agentId, () => true, 20_000);
      } catch {
        // Timeout or socket closed. Keep looping unless we're stopped or the
        // daemon connection is gone — waitFor() rejects immediately on close
        // so this doesn't linger for the full timeout window.
        if (stopped || daemon.closed) return;
        continue;
      }
      if (stopped) return;
      if (busy) {
        // Mid-turn — queue this delivery's cursor to ack once idle instead
        // of acking (and catching the cursor up) mid-reply.
        pendingAck = { seq: event.seq, cursor: event.cursor };
        continue;
      }
      // Fire-and-forget: handleDelivery sets busy = true synchronously
      // before its first await, so the next loop iteration's busy check
      // above always sees an accurate value.
      handleDelivery(event).catch((err) => {
        console.error(`[scripted-agent:${name}] delivery handling error:`, err.message);
      });
    }
  })();

  return {
    agentId,
    name,
    counters,
    stop() { stopped = true; },
  };
}
