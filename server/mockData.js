/**
 * Mock data seed for PR previews / dev environments where Supabase isn't
 * configured. Populates a handful of agents, machines, channels, humans and
 * messages so the UI has something to render on a fresh boot.
 *
 * Only seeds when:
 *   - Supabase is disabled (no SUPABASE_URL / SUPABASE_SERVICE_KEY), AND
 *   - process.env.ZOUK_NO_MOCK is not set, AND
 *   - the relevant store slice is empty (so we never overwrite real data)
 */

function shouldSeed(db) {
  if (db && db.enabled) return false;
  if (process.env.ZOUK_NO_MOCK === "1") return false;
  return true;
}

function seed({ store, agentConfigs, machines, addHumanPresence, findOrCreateChannel }) {
  // Channels
  const wantedChannels = [
    { name: "all", description: "General workspace channel" },
    { name: "engineering", description: "Engineering discussion" },
    { name: "design", description: "Design crits and reviews" },
    { name: "ops", description: "Operations + on-call" },
  ];
  for (const c of wantedChannels) {
    const ch = findOrCreateChannel(c.name);
    if (!ch.description) ch.description = c.description;
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

  // Mock messages — only if store.messages is empty so we don't double-seed
  if (store.messages.length === 0) {
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
    let seq = store.seq;
    samples.forEach((s, i) => {
      const ch = findOrCreateChannel(s.channel);
      seq += 1;
      store.messages.push({
        id: `mock-msg-${i + 1}`,
        seq,
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
    });
    store.seq = seq;
  }

  console.log("[mock] Seeded mock channels, agents, machines, messages (Supabase off)");
}

module.exports = { shouldSeed, seed };
