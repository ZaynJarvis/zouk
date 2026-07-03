/**
 * Mock data seed for PR previews / dev environments where no DB is
 * configured. Populates a handful of agents, machines, channels, humans and
 * messages so the UI has something to render on a fresh boot.
 *
 * Only seeds when:
 *   - DB persistence is disabled (no DATABASE_URL), AND
 *   - process.env.ZOUK_NO_MOCK is not set, AND
 *   - the relevant store slice is empty (so we never overwrite real data)
 */

function shouldSeed(db) {
  if (db && db.enabled) return false;
  if (process.env.ZOUK_NO_MOCK === "1") return false;
  return true;
}

async function seed({ store, agentConfigs, machines, addHumanPresence, findOrCreateChannel, setMembership, getMembership, appendMessage }) {
  // Channels
  const wantedChannels = [
    { name: "all", description: "General workspace channel" },
    { name: "engineering", description: "Engineering discussion" },
    { name: "design", description: "Design crits and reviews" },
    { name: "ops", description: "Operations + on-call" },
  ];
  const createdChannels = [];
  for (const c of wantedChannels) {
    const ch = await findOrCreateChannel(c.name);
    if (!ch.description) ch.description = c.description;
    createdChannels.push(ch);
  }

  // Mock machines
  const mockMachines = [
    {
      id: "machine-mock-laptop",
      hostname: "preview-laptop.local",
      alias: "Preview Laptop",
      os: "darwin",
      runtimes: ["claude", "openai"],
      capabilities: ["workspace_fs"],
      connectedAt: new Date().toISOString(),
      agentIds: ["agent-mock-reviewer", "agent-mock-bugbot"],
      status: "online",
    },
    {
      id: "machine-mock-cloud",
      hostname: "preview-runner-1",
      alias: "Cloud Runner",
      os: "linux",
      runtimes: ["claude"],
      capabilities: [],
      connectedAt: new Date().toISOString(),
      agentIds: ["agent-mock-deployer"],
      status: "online",
    },
  ];
  for (const m of mockMachines) {
    if (!machines.has(m.id)) machines.set(m.id, m);
  }

  // Mock agents (configs + runtime store entries)
  const mockAgents = [
    {
      id: "agent-mock-reviewer",
      name: "reviewer",
      displayName: "Code Reviewer",
      description: "Reviews PRs and gives feedback",
      runtime: "claude",
      model: "claude-opus-4-7",
      machineId: "machine-mock-laptop",
      visibility: "workspace",
      maxConcurrentTasks: 4,
      autoStart: true,
      activity: "online",
    },
    {
      id: "agent-mock-bugbot",
      name: "bugbot",
      displayName: "Bug Triager",
      description: "Triages incoming bug reports",
      runtime: "claude",
      model: "claude-sonnet-4-6",
      machineId: "machine-mock-laptop",
      visibility: "workspace",
      maxConcurrentTasks: 6,
      autoStart: true,
      activity: "thinking",
    },
    {
      id: "agent-mock-deployer",
      name: "deployer",
      displayName: "Deploy Bot",
      description: "Runs deploys + smoke tests",
      runtime: "claude",
      model: "claude-haiku-4-5-20251001",
      machineId: "machine-mock-cloud",
      visibility: "workspace",
      maxConcurrentTasks: 2,
      autoStart: false,
      activity: "online",
    },
  ];

  if (agentConfigs.length === 0) {
    for (const a of mockAgents) {
      agentConfigs.push({
        id: a.id,
        name: a.name,
        displayName: a.displayName,
        description: a.description,
        runtime: a.runtime,
        model: a.model,
        serverUrl: "http://localhost:7777",
        visibility: a.visibility,
        maxConcurrentTasks: a.maxConcurrentTasks,
        autoStart: a.autoStart,
      });
    }
  }

  for (const a of mockAgents) {
    if (!store.agents[a.id]) {
      store.agents[a.id] = {
        name: a.name,
        displayName: a.displayName,
        description: a.description,
        runtime: a.runtime,
        model: a.model,
        machineId: a.machineId,
        status: "active",
        activity: a.activity,
      };
    }
  }

  // Explicitly subscribe mock agents to all preview channels so the UI has
  // something to render. New channels/agents no longer auto-subscribe by default;
  // mock data opts in explicitly to preserve the full preview experience.
  if (typeof setMembership === "function" && typeof getMembership === "function") {
    for (const a of mockAgents) {
      for (const ch of createdChannels) {
        if (!getMembership(ch.id, a.id)) {
          await setMembership(ch.id, a.id, { canRead: true, subscribed: true });
        }
      }
    }
  }

  // Mock humans (online presence)
  if (typeof addHumanPresence === "function") {
    for (const h of [
      { name: "alice", picture: null },
      { name: "bob", picture: null },
      { name: "carol", picture: null },
    ]) {
      addHumanPresence({ id: `human:${h.name}`, name: h.name, picture: h.picture });
    }
  }

  // Mock messages — only seed when the per-channel cache is empty so we never
  // double-seed. Route through appendMessage so the threading index, channel
  // cache, and taskTimes all stay consistent with normal runtime writes.
  const alreadySeeded = [...store.channelMessages.values()].some((arr) => arr.length > 0);
  if (!alreadySeeded && typeof appendMessage === "function") {
    const baseTime = Date.now() - 1000 * 60 * 60 * 6;
    const samples = [
      { channel: "all", sender: "alice", senderType: "human", content: "morning! just kicked off the release branch QA." },
      { channel: "all", sender: "Code Reviewer", senderType: "agent", content: "Reviewed PR #123. LGTM with one comment about error handling." },
      { channel: "engineering", sender: "bob", senderType: "human", content: "anyone seeing the websocket reconnect spam in dev?" },
      { channel: "engineering", sender: "Bug Triager", senderType: "agent", content: "Logged 3 bugs from yesterday's session. Top one is a race in `selectChannel`." },
      { channel: "engineering", sender: "carol", senderType: "human", content: "I think it landed in 0679211. Will check." },
      { channel: "design", sender: "alice", senderType: "human", content: "new sidebar mocks pushed to figma. CRs welcome." },
      { channel: "ops", sender: "Deploy Bot", senderType: "agent", content: "deploy preview-2026-04-18 healthy ✅" },
      { channel: "ops", sender: "bob", senderType: "human", content: "thanks. holding the prod push until QA signs off." },
    ];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const ch = await findOrCreateChannel(s.channel);
      store.seq += 1;
      appendMessage({
        id: `mock-msg-${i + 1}`,
        seq: store.seq,
        channelId: ch.id,
        channelName: s.channel,
        channelType: "channel",
        threadId: null,
        senderName: s.sender,
        senderType: s.senderType,
        content: s.content,
        createdAt: new Date(baseTime + i * 1000 * 60 * 12).toISOString(),
        attachments: [],
      });
    }
  }

  console.log("[mock] Seeded mock channels, agents, machines, messages (no DB)");
}

module.exports = { shouldSeed, seed };
