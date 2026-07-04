// Agent clone feature tests.
//
// Exercises the full clone lifecycle using ZoukSimulation + SimulatedDaemon:
//   1. Clone via API → daemon receives agent:start with distinct agentId, same workDir, OV fields inherited
//   2. DM to clone answered only by clone
//   3. DM to parent answered only by parent
//   4. Channel message → delivered to parent, NOT clone (anti-double-reply)
//   5. Mention of clone name in channel → delivered to clone
//   6. Stop clone → config gone (dissolve), parent intact
//   7. Clone-of-clone rejected
//   8. Cap enforced (4 live clones per parent)
//   9. Name allocation dodges an existing same-name agent
//  10. Clone names use dot notation (zeus.2) and pass validation
//  11. DM with dot handle resolves
//  12. @mention with dot handle resolves
//  13. Non-clone agent with dot in name is rejected

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createZoukSimulation } from "./test-support/zouk-simulation.mjs";

const SLEEP_SETTLE_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("agent clone", () => {
  let sim;
  let daemon;
  let parentId;
  let parentName = "zeus";
  let machineKeyId;

  beforeEach(async () => {
    sim = await createZoukSimulation({ mock: true });
    // Create a machine key so the daemon can connect
    const machineKeyResult = await sim.createMachineKey("sim-machine");
    machineKeyId = machineKeyResult.key.id;
    const machineRawKey = machineKeyResult.rawKey;
    // Connect a simulated daemon using the actual machine key
    daemon = await sim.connectDaemon({ key: machineRawKey });
    daemon.ready({ runtimes: ["claude"] });
    await sleep(SLEEP_SETTLE_MS);

    // Start the parent agent WITHOUT pre-creating a config.
    // This way startAgentOnDaemon treats it as a new agent and calls
    // seedAgentIntoRegularChannels, subscribing the parent to #all.
    const startResult = await sim.startAgent({
      id: "agent-zeus01",
      name: parentName,
      displayName: "Zeus",
      runtime: "claude",
      model: "sonnet",
      machineId: machineKeyId,
      workDir: "/home/zeus/workspace",
      description: "God of thunder",
      openvikingEnabled: true,
      openvikingUserId: "zeus",
      openvikingApiKey: "ov-zeus-key",
      openvikingSessionId: "zeus",
    });
    parentId = startResult.agentId;

    // Wait for the daemon to receive agent:start and respond
    const startEvt = await daemon.waitForStart(parentId, 2000);
    assert.ok(startEvt, "daemon should receive agent:start for parent");
    daemon.agentStatus(parentId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);
  });

  afterEach(async () => {
    if (daemon) await daemon.close().catch(() => {});
    if (sim) await sim.stop().catch(() => {});
  });

  it("clone via API creates a new agent with distinct id and shared workDir", async () => {
    const result = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    assert.ok(result.cloneId, "response should include cloneId");
    assert.ok(result.name, "response should include name");
    assert.ok(result.cloneId !== parentId, "cloneId should differ from parentId");
    assert.ok(result.name.startsWith(parentName + "."), "clone name should have .N suffix");
    // First clone should be .2 (parent is implicitly .1)
    assert.equal(result.name, parentName + ".2", "first clone should be named zeus.2");

    // Verify daemon received agent:start for the clone
    const startEvt = await daemon.waitForStart(result.cloneId, 2000);
    assert.ok(startEvt, "daemon should receive agent:start for clone");
    assert.equal(startEvt.config.workDir, "/home/zeus/workspace", "clone should share parent's workDir");
    assert.equal(startEvt.config.lifecycle, "ephemeral", "clone should be ephemeral");
    assert.ok(startEvt.config.name.startsWith(parentName + "."), "clone daemon config should have .N name");

    // Verify OV fields are inherited
    assert.ok(startEvt.config.openviking, "clone should have OV config");
    assert.equal(startEvt.config.openviking.userId, "zeus", "clone should share parent's OV user id");

    // Respond to the clone's start so it becomes active
    daemon.agentStatus(result.cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Verify clone shows up in agent configs
    const configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    const cloneCfg = configs.configs.find((c) => c.id === result.cloneId);
    assert.ok(cloneCfg, "clone config should exist");
    assert.equal(cloneCfg.cloneOf, parentId, "clone config should have cloneOf set to parent");
    assert.equal(cloneCfg.workDir, "/home/zeus/workspace", "clone config should have parent's workDir");
    assert.equal(cloneCfg.autoStart, false, "clone should have autoStart false");
    assert.equal(cloneCfg.lifecycle, "ephemeral", "clone config should be ephemeral");
  });

  it("DM to clone is delivered only to clone, not parent", async () => {
    // Create clone
    const cloneResult = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    const cloneId = cloneResult.cloneId;
    const cloneName = cloneResult.name;
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Send a DM to the clone (dot handle: dm:@zeus.2)
    const dmTarget = `dm:@${cloneName}`;
    await sim.sendHumanMessage({ target: dmTarget, content: "Hello clone, do this task" });

    // The clone should receive the delivery
    const cloneDelivery = await daemon.waitForDelivery(cloneId, (e) => {
      return e.message && e.message.content === "Hello clone, do this task";
    }, 3000);
    assert.ok(cloneDelivery, "clone should receive DM delivery");

    // The parent should NOT receive this DM
    const parentDelivery = await daemon.waitForOrNull(
      (e) => e.type === "agent:deliver" && e.agentId === parentId && e.message?.content === "Hello clone, do this task",
      800
    );
    assert.equal(parentDelivery, null, "parent should NOT receive the DM to clone");
  });

  it("DM to parent is delivered only to parent, not clone", async () => {
    // Create clone
    const cloneResult = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    const cloneId = cloneResult.cloneId;
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Send a DM to the parent
    const dmTarget = `dm:@${parentName}`;
    await sim.sendHumanMessage({ target: dmTarget, content: "Hello parent, do this task" });

    // The parent should receive the delivery
    const parentDelivery = await daemon.waitForDelivery(parentId, (e) => {
      return e.message && e.message.content === "Hello parent, do this task";
    }, 3000);
    assert.ok(parentDelivery, "parent should receive DM delivery");

    // The clone should NOT receive this DM
    const cloneDelivery = await daemon.waitForOrNull(
      (e) => e.type === "agent:deliver" && e.agentId === cloneId && e.message?.content === "Hello parent, do this task",
      800
    );
    assert.equal(cloneDelivery, null, "clone should NOT receive the DM to parent");
  });

  it("channel message is delivered to parent but NOT to clone (anti-double-reply)", async () => {
    // Create clone
    const cloneResult = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    const cloneId = cloneResult.cloneId;
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Send a message to #all that explicitly mentions the parent.
    // The #all channel has 4+ agents (large channel threshold), so broadcasts
    // only go to "active" agents or explicitly-mentioned ones. Mentioning the
    // parent ensures it's in the directed set.
    await sim.sendHumanMessage({ target: "#all", content: `Hey @${parentName}, broadcast to all` });

    // Parent should receive it (explicitly mentioned)
    const parentDelivery = await daemon.waitForDelivery(parentId, (e) => {
      return e.message && e.message.content.includes("broadcast to all");
    }, 3000);
    assert.ok(parentDelivery, "parent should receive channel message when mentioned");

    // Clone should NOT receive it (not subscribed to #all, not mentioned)
    const cloneDelivery = await daemon.waitForOrNull(
      (e) => e.type === "agent:deliver" && e.agentId === cloneId && e.message?.content?.includes("broadcast to all"),
      800
    );
    assert.equal(cloneDelivery, null, "clone should NOT receive channel broadcast (anti-double-reply)");
  });

  it("clone does NOT receive channel messages even when mentioned (DM-only policy)", async () => {
    // Create clone
    const cloneResult = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    const cloneId = cloneResult.cloneId;
    const cloneName = cloneResult.name;
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Send a message mentioning the clone in #all.
    // Clones are DM-only by default — they don't have a channel membership,
    // so the delivery router's visible-agent filter excludes them.
    await sim.sendHumanMessage({ target: "#all", content: `Hey @${cloneName}, can you help?` });

    // Clone should NOT receive the channel mention because it's not subscribed
    // to #all (DM-only policy). The delivery router intersects directed agents
    // with visible (subscribed + active) agents.
    const cloneDelivery = await daemon.waitForOrNull(
      (e) => e.type === "agent:deliver" && e.agentId === cloneId && e.message?.content?.includes(cloneName),
      800
    );
    assert.equal(cloneDelivery, null, "clone should NOT receive channel mentions (DM-only policy)");

    // But the clone SHOULD receive a direct DM
    await sim.sendHumanMessage({ target: `dm:@${cloneName}`, content: "This is a DM to the clone" });
    const dmDelivery = await daemon.waitForDelivery(cloneId, (e) => {
      return e.message && e.message.content === "This is a DM to the clone";
    }, 3000);
    assert.ok(dmDelivery, "clone should receive DMs");
  });

  it("stopping a clone dissolves it (config removed, parent intact)", async () => {
    // Create clone
    const cloneResult = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    const cloneId = cloneResult.cloneId;
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Verify clone exists in configs
    let configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    assert.ok(configs.configs.find((c) => c.id === cloneId), "clone should exist before stop");

    // Stop the clone (this triggers dissolve for clones)
    await sim.stopAgent(cloneId);
    await sleep(SLEEP_SETTLE_MS);

    // Verify clone config is gone
    configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    assert.equal(
      configs.configs.find((c) => c.id === cloneId),
      undefined,
      "clone config should be removed after stop (dissolve)"
    );

    // Verify parent config still exists
    assert.ok(
      configs.configs.find((c) => c.id === parentId),
      "parent config should still exist after clone dissolve"
    );
  });

  it("clone-of-clone is rejected", async () => {
    // Create clone 1
    const clone1 = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    const clone1Id = clone1.cloneId;
    daemon.agentStatus(clone1Id, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Try to clone the clone — should be rejected
    const res = await sim.json("POST", `/api/agents/${clone1Id}/clone`, { token: sim.rootToken });
    assert.equal(res.status, 400, "clone of clone should return 400");
    assert.ok(
      res.body?.error?.toLowerCase().includes("clone"),
      "error message should mention cloning restriction"
    );
  });

  it("enforces max 4 live clones per parent", async () => {
    // Create 4 clones (the max). First clone is .2, then .3, .4, .5
    const cloneIds = [];
    for (let i = 0; i < 4; i++) {
      const result = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
      cloneIds.push(result.cloneId);
      daemon.agentStatus(result.cloneId, { status: "active", workDir: "/home/zeus/workspace" });
      await sleep(SLEEP_SETTLE_MS);
    }

    // Verify all 4 exist
    const configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    const cloneConfigs = configs.configs.filter((c) => c.cloneOf === parentId);
    assert.equal(cloneConfigs.length, 4, "should have 4 live clones");

    // Try to create a 5th — should be rejected
    const res = await sim.json("POST", `/api/agents/${parentId}/clone`, { token: sim.rootToken });
    assert.equal(res.status, 409, "5th clone should return 409 (cap enforced)");
  });

  it("name allocation dodges used clone numbers (sequential numbering)", async () => {
    // Create first clone — should be .2 (parent is implicitly .1)
    const result1 = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    assert.equal(result1.name, "zeus.2", "first clone should be zeus.2");
    daemon.agentStatus(result1.cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Create second clone — should be .3 (dodges .2 which is taken)
    const result2 = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    assert.equal(result2.name, "zeus.3", "second clone should be zeus.3");
    daemon.agentStatus(result2.cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Create third clone — should be .4
    const result3 = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    assert.equal(result3.name, "zeus.4", "third clone should be zeus.4");
  });

  it("name allocation recognizes legacy -cN clone names", async () => {
    // Pre-create a config that looks like a legacy clone with -c99 name
    await sim.createAgentConfig({
      id: "agent-zeus01-c99",
      name: "zeus-c99",
      displayName: "Legacy Clone",
      runtime: "claude",
      model: "sonnet",
      machineId: machineKeyId,
      workDir: "/tmp/legacy",
      cloneOf: parentId,
      lifecycle: "ephemeral",
      autoStart: false,
    });

    // Clone the parent — the legacy -c99 should be recognized and number 99
    // should be in the used set. The first available number starting from 2
    // that's not used is 2 (99 is used but 2 is free).
    const result = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    assert.ok(result.name, "clone should have a name");
    assert.equal(result.name, "zeus.2", "clone should use .2 (legacy -c99 doesn't block it)");
  });

  it("clone with initial prompt posts a DM to the clone", async () => {
    const result = await sim.post(
      `/api/agents/${parentId}/clone`,
      { prompt: "Please analyze the logs and summarize findings" },
      { token: sim.rootToken }
    );
    const cloneId = result.cloneId;
    const cloneName = result.name;
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // The clone should receive the initial prompt as a DM delivery
    const delivery = await daemon.waitForDelivery(cloneId, (e) => {
      return e.message && e.message.content === "Please analyze the logs and summarize findings";
    }, 3000);
    assert.ok(delivery, "clone should receive the initial prompt as DM delivery");
  });

  it("clone name with dot passes validation (clone creation succeeds)", async () => {
    // Clones inherit the parent's OV identity explicitly (openvikingUserId,
    // openvikingApiKey) and never derive an OV id from their own name. The
    // clone path bypasses isValidAgentHandle (which rejects dots), going
    // directly through cloneAgent → startAgentOnDaemon with a pre-built config.
    // This test verifies the dot-named clone is created successfully.
    const result = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    assert.ok(result.cloneId, "clone should be created with dot name");
    assert.ok(result.name.includes("."), "clone name should contain a dot");

    // Verify the clone's name includes the parent name and a number
    const match = result.name.match(/^zeus\.(\d+)$/);
    assert.ok(match, "clone name should match zeus.N pattern");
    assert.ok(parseInt(match[1], 10) >= 2, "clone number should be >= 2");
  });

  it("non-clone agent with dot in name is rejected", async () => {
    // Manually creating a regular agent (not a clone) with a dot in the name
    // should fail because isValidAgentHandle enforces AGENT_HANDLE_RE which
    // does not allow dots. Regular agents back their OV user_id with their
    // handle, so the handle must be a path-safe identifier.
    const res = await sim.json("POST", "/api/agents/start", {
      token: sim.rootToken,
      body: {
        id: "agent-dottest01",
        name: "test.agent",
        displayName: "Test Dot",
        runtime: "claude",
        model: "sonnet",
        machineId: machineKeyId,
        workDir: "/tmp/dottest",
      },
    });
    assert.equal(res.status, 400, "non-clone agent with dot name should return 400");
    assert.ok(
      res.body?.error?.toLowerCase().includes("name") || res.body?.error?.toLowerCase().includes("lowercase"),
      "error message should mention name validation"
    );
  });

  it("DM target with dot handle resolves to correct channel", async () => {
    // Create a clone with dot name
    const cloneResult = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    const cloneId = cloneResult.cloneId;
    const cloneName = cloneResult.name; // e.g. "zeus.2"
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Verify the clone name has a dot
    assert.ok(cloneName.includes("."), "clone name should have a dot");

    // Send a DM using the dot handle
    const dmTarget = `dm:@${cloneName}`;
    await sim.sendHumanMessage({ target: dmTarget, content: "DM to dot-handle clone" });

    // Clone should receive it
    const delivery = await daemon.waitForDelivery(cloneId, (e) => {
      return e.message && e.message.content === "DM to dot-handle clone";
    }, 3000);
    assert.ok(delivery, "clone with dot handle should receive DM");

    // Verify the DM channel name was correctly formed (includes the dot).
    // Successful delivery confirms parseTarget correctly handled the dot.
  });

  it("@mention regex correctly extracts dot handle from content", async () => {
    // Verify the mention regex includes dots in the extracted handle.
    // The regex: /@([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu
    const content1 = "Hey @zeus.2, please help with this";
    const match1 = content1.match(/@([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu);
    assert.ok(match1, "should find a mention match");
    assert.equal(match1[0], "@zeus.2", "mention should include the full dot handle");

    // Trailing dot should NOT be included (sentence punctuation)
    const content2 = "Hey @zeus.2. How are you?";
    const match2 = content2.match(/@([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu);
    assert.ok(match2, "should find a mention with trailing dot");
    assert.equal(match2[0], "@zeus.2", "trailing dot should not be included in mention");

    // Multi-level dots (unlikely but safe)
    const content3 = "@foo.bar.baz mentioned";
    const match3 = content3.match(/@([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu);
    assert.ok(match3, "should find multi-dot mention");
    assert.equal(match3[0], "@foo.bar.baz", "multi-dot handles should work");

    // Plain handle without dots still works
    const content4 = "@zeus help";
    const match4 = content4.match(/@([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu);
    assert.ok(match4, "should find plain mention");
    assert.equal(match4[0], "@zeus", "plain mention without dots should work");
  });
});

// ─── Clone idle auto-dissolve + dissolve tool tests ──────────────

describe("clone idle auto-dissolve", () => {
  let sim;
  let daemon;
  let parentId;
  const parentName = "zeus";
  let machineKeyId;

  async function setupWithSweepInterval(sweepIntervalMs) {
    sim = await createZoukSimulation({
      mock: true,
      env: sweepIntervalMs ? { ZOUK_CLONE_SWEEP_INTERVAL_MS: String(sweepIntervalMs) } : {},
    });
    const machineKeyResult = await sim.createMachineKey("sim-machine");
    machineKeyId = machineKeyResult.key.id;
    const machineRawKey = machineKeyResult.rawKey;
    daemon = await sim.connectDaemon({ key: machineRawKey });
    daemon.ready({ runtimes: ["claude"] });
    await sleep(SLEEP_SETTLE_MS);

    const startResult = await sim.startAgent({
      id: "agent-zeus01",
      name: parentName,
      displayName: "Zeus",
      runtime: "claude",
      model: "sonnet",
      machineId: machineKeyId,
      workDir: "/home/zeus/workspace",
      description: "God of thunder",
      openvikingEnabled: true,
      openvikingUserId: "zeus",
      openvikingApiKey: "ov-zeus-key",
      openvikingSessionId: "zeus",
    });
    parentId = startResult.agentId;

    const startEvt = await daemon.waitForStart(parentId, 2000);
    assert.ok(startEvt, "daemon should receive agent:start for parent");
    daemon.agentStatus(parentId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);
  }

  afterEach(async () => {
    if (daemon) await daemon.close().catch(() => {});
    if (sim) await sim.stop().catch(() => {});
  });

  it("clone created with tiny idleMinutes auto-dissolves after TTL", async () => {
    await setupWithSweepInterval(200); // 200ms sweep interval
    const idleMinutes = 0.03; // ~1.8 seconds
    const result = await sim.post(
      `/api/agents/${parentId}/clone`,
      { idleMinutes },
      { token: sim.rootToken }
    );
    const cloneId = result.cloneId;
    const cloneName = result.name;
    assert.ok(cloneId, "clone should be created");
    assert.ok(result.cloneIdleTtlMs, "response should include cloneIdleTtlMs");
    assert.ok(
      result.cloneIdleTtlMs >= 1700 && result.cloneIdleTtlMs <= 1900,
      `cloneIdleTtlMs should be ~1800ms, got ${result.cloneIdleTtlMs}`
    );

    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Verify clone exists
    let configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    assert.ok(configs.configs.find((c) => c.id === cloneId), "clone should exist before TTL");

    // Wait for auto-dissolve (TTL ~1.8s, sweep every 200ms → should dissolve within ~2.5s)
    const dissolved = await sim.waitUntil(async () => {
      const cfgs = await sim.get("/api/agent-configs", { token: sim.rootToken });
      return !cfgs.configs.find((c) => c.id === cloneId);
    }, "clone auto-dissolve", 5000, 100);
    assert.ok(dissolved, "clone should be auto-dissolved after idle TTL");

    // Verify parent still exists
    configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    assert.ok(configs.configs.find((c) => c.id === parentId), "parent should still exist");
  });

  it("activity resets the idle clock", async () => {
    await setupWithSweepInterval(200);
    const idleMinutes = 0.05; // ~3 seconds
    const result = await sim.post(
      `/api/agents/${parentId}/clone`,
      { idleMinutes },
      { token: sim.rootToken }
    );
    const cloneId = result.cloneId;
    const cloneName = result.name;
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Wait 1.5s (half of TTL), then send a DM to the clone to reset idle clock
    await sleep(1500);
    await sim.sendHumanMessage({ target: `dm:@${cloneName}`, content: "wake up clone" });

    // The delivery should reset the idle timestamp.
    // Wait another 2s — if the clock was NOT reset, the clone would have been
    // idle for 3.5s > 3s TTL and should be dissolved. But since we reset it,
    // it should still be alive.
    await sleep(2000);

    const configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    assert.ok(
      configs.configs.find((c) => c.id === cloneId),
      "clone should still exist after activity reset idle clock (total idle < TTL since last activity)"
    );
  });

  it("default TTL applied when idleMinutes omitted", async () => {
    await setupWithSweepInterval();
    const result = await sim.post(
      `/api/agents/${parentId}/clone`,
      {},
      { token: sim.rootToken }
    );
    const cloneId = result.cloneId;
    assert.ok(cloneId, "clone should be created");
    assert.ok(result.cloneIdleTtlMs, "response should include cloneIdleTtlMs");
    assert.equal(
      result.cloneIdleTtlMs,
      30 * 60_000,
      "default cloneIdleTtlMs should be 30 minutes"
    );

    // Verify the config has the value
    const configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    const cloneCfg = configs.configs.find((c) => c.id === cloneId);
    assert.ok(cloneCfg, "clone config should exist");
    assert.equal(cloneCfg.cloneIdleTtlMs, 30 * 60_000, "config should have default TTL");
  });

  it("invalid idleMinutes values fall back to default", async () => {
    await setupWithSweepInterval();
    const testCases = [0, -1, "abc", null, undefined];
    for (const bad of testCases) {
      const result = await sim.post(
        `/api/agents/${parentId}/clone`,
        { idleMinutes: bad },
        { token: sim.rootToken }
      );
      // Some may fail due to cap (4 clones max). Check only if created.
      if (result.cloneId) {
        assert.equal(
          result.cloneIdleTtlMs,
          30 * 60_000,
          `idleMinutes=${JSON.stringify(bad)} should default to 30m`
        );
        // Clean up by stopping (dissolving) the clone
        await sim.stopAgent(result.cloneId);
        await sleep(100);
      }
    }
  });

  it("idleMinutes is capped at 1440 (24h)", async () => {
    await setupWithSweepInterval();
    const result = await sim.post(
      `/api/agents/${parentId}/clone`,
      { idleMinutes: 2000 },
      { token: sim.rootToken }
    );
    assert.ok(result.cloneId, "clone should be created");
    assert.equal(
      result.cloneIdleTtlMs,
      1440 * 60_000,
      "cloneIdleTtlMs should be capped at 1440 minutes"
    );
  });
});

describe("clone dissolve tool (MCP)", () => {
  let sim;
  let daemon;
  let parentId;
  const parentName = "zeus";
  let machineKeyId;

  beforeEach(async () => {
    sim = await createZoukSimulation({ mock: true });
    const machineKeyResult = await sim.createMachineKey("sim-machine");
    machineKeyId = machineKeyResult.key.id;
    const machineRawKey = machineKeyResult.rawKey;
    daemon = await sim.connectDaemon({ key: machineRawKey });
    daemon.ready({ runtimes: ["claude"] });
    await sleep(SLEEP_SETTLE_MS);

    const startResult = await sim.startAgent({
      id: "agent-zeus01",
      name: parentName,
      displayName: "Zeus",
      runtime: "claude",
      model: "sonnet",
      machineId: machineKeyId,
      workDir: "/home/zeus/workspace",
      description: "God of thunder",
      openvikingEnabled: true,
      openvikingUserId: "zeus",
      openvikingApiKey: "ov-zeus-key",
      openvikingSessionId: "zeus",
    });
    parentId = startResult.agentId;

    const startEvt = await daemon.waitForStart(parentId, 2000);
    assert.ok(startEvt, "daemon should receive agent:start for parent");
    daemon.agentStatus(parentId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);
  });

  afterEach(async () => {
    if (daemon) await daemon.close().catch(() => {});
    if (sim) await sim.stop().catch(() => {});
  });

  async function createClone(idleMinutes) {
    const body = {};
    if (idleMinutes !== undefined) body.idleMinutes = idleMinutes;
    const result = await sim.post(
      `/api/agents/${parentId}/clone`,
      body,
      { token: sim.rootToken }
    );
    daemon.agentStatus(result.cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);
    return result;
  }

  it("self-dissolve via internal route works for a clone", async () => {
    const clone = await createClone();
    const cloneId = clone.cloneId;

    // Call dissolve on the clone itself (self-dissolve)
    const res = await sim.json("POST", `/internal/agent/${cloneId}/dissolve`, {
      body: {},
    });
    assert.equal(res.status, 200, "self-dissolve should succeed for a clone");
    assert.ok(res.body?.success, "response should indicate success");

    // Verify clone is gone
    const configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    assert.equal(
      configs.configs.find((c) => c.id === cloneId),
      undefined,
      "clone config should be removed after self-dissolve"
    );

    // Parent still exists
    assert.ok(configs.configs.find((c) => c.id === parentId), "parent should still exist");
  });

  it("parent dissolves own clone by name", async () => {
    const clone = await createClone();
    const cloneId = clone.cloneId;
    const cloneName = clone.name;

    // Call dissolve from the parent targeting the clone by name
    const res = await sim.json("POST", `/internal/agent/${parentId}/dissolve`, {
      body: { target: cloneName },
    });
    assert.equal(res.status, 200, "parent dissolving own clone should succeed");
    assert.ok(res.body?.success, "response should indicate success");
    assert.equal(res.body?.dissolved, cloneName, "response should name the dissolved clone");

    // Verify clone is gone
    const configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    assert.equal(
      configs.configs.find((c) => c.id === cloneId),
      undefined,
      "clone config should be removed after parent dissolve"
    );
  });

  it("403: dissolve targeting the parent (non-clone)", async () => {
    // Create a second agent to use as the caller
    const otherResult = await sim.startAgent({
      id: "agent-athena01",
      name: "athena",
      displayName: "Athena",
      runtime: "claude",
      model: "sonnet",
      machineId: machineKeyId,
      workDir: "/home/athena/workspace",
    });
    daemon.agentStatus(otherResult.agentId, { status: "active", workDir: "/home/athena/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Try to dissolve the parent (not a clone) from athena
    const res = await sim.json("POST", `/internal/agent/${otherResult.agentId}/dissolve`, {
      body: { target: parentName },
    });
    assert.equal(res.status, 403, "dissolving a non-clone should return 403");
    assert.ok(
      res.body?.error?.toLowerCase().includes("not a clone") || res.body?.error?.toLowerCase().includes("non-clone"),
      "error should mention that target is not a clone"
    );
  });

  it("403: self-dissolve from a non-clone agent", async () => {
    // Try to self-dissolve the parent (not a clone)
    const res = await sim.json("POST", `/internal/agent/${parentId}/dissolve`, {
      body: {},
    });
    assert.equal(res.status, 403, "self-dissolve from non-clone should return 403");
    assert.ok(
      res.body?.error?.toLowerCase().includes("clone"),
      "error should mention that self-dissolve is only for clones"
    );
  });

  it("403: dissolve targeting another agent's clone", async () => {
    // Create a clone of zeus
    const zeusClone = await createClone();

    // Create a second parent agent
    const otherResult = await sim.startAgent({
      id: "agent-athena01",
      name: "athena",
      displayName: "Athena",
      runtime: "claude",
      model: "sonnet",
      machineId: machineKeyId,
      workDir: "/home/athena/workspace",
    });
    daemon.agentStatus(otherResult.agentId, { status: "active", workDir: "/home/athena/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // athena tries to dissolve zeus's clone — should fail
    const res = await sim.json("POST", `/internal/agent/${otherResult.agentId}/dissolve`, {
      body: { target: zeusClone.name },
    });
    assert.equal(res.status, 403, "dissolving someone else's clone should return 403");
    assert.ok(
      res.body?.error?.toLowerCase().includes("parent"),
      "error should mention that caller is not the parent"
    );

    // Verify zeus's clone still exists
    const configs = await sim.get("/api/agent-configs", { token: sim.rootToken });
    assert.ok(
      configs.configs.find((c) => c.id === zeusClone.cloneId),
      "zeus's clone should still exist after failed dissolve attempt"
    );
  });

  it("404: dissolve targeting non-existent agent", async () => {
    const res = await sim.json("POST", `/internal/agent/${parentId}/dissolve`, {
      body: { target: "nonexistent" },
    });
    assert.equal(res.status, 404, "dissolving non-existent agent should return 404");
  });

  it("DM notice posted before auto-dissolve", async () => {
    // Create a clone with tiny TTL and fast sweep
    // We need a fresh sim with sweep env
    await sim.stop();
    sim = await createZoukSimulation({
      mock: true,
      env: { ZOUK_CLONE_SWEEP_INTERVAL_MS: "200" },
    });
    const mk = await sim.createMachineKey("sim-machine2");
    const rawKey = mk.rawKey;
    daemon = await sim.connectDaemon({ key: rawKey });
    daemon.ready({ runtimes: ["claude"] });
    await sleep(SLEEP_SETTLE_MS);

    const sr = await sim.startAgent({
      id: "agent-zeus02",
      name: "zeus",
      displayName: "Zeus",
      runtime: "claude",
      model: "sonnet",
      machineId: mk.key.id,
      workDir: "/home/zeus/workspace",
    });
    daemon.agentStatus(sr.agentId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    const cloneResult = await sim.post(
      `/api/agents/${sr.agentId}/clone`,
      { idleMinutes: 0.03 },
      { token: sim.rootToken }
    );
    const cloneId = cloneResult.cloneId;
    const cloneName = cloneResult.name;
    daemon.agentStatus(cloneId, { status: "active", workDir: "/home/zeus/workspace" });
    await sleep(SLEEP_SETTLE_MS);

    // Wait for auto-dissolve
    await sim.waitUntil(async () => {
      const cfgs = await sim.get("/api/agent-configs", { token: sim.rootToken });
      return !cfgs.configs.find((c) => c.id === cloneId);
    }, "clone auto-dissolve with DM notice", 5000, 100);

    // Check DM channel history for the auto-dissolve notice
    const dmChannelName = `dm:${["zeus", cloneName].sort().join(",")}`;
    const msgs = await sim.getMessages({ channel: dmChannelName });
    const notice = msgs.messages?.find((m) =>
      m.content?.includes("auto-dissolved")
    );
    assert.ok(notice, `DM notice about auto-dissolve should exist in ${dmChannelName}. Got: ${JSON.stringify(msgs.messages?.map(m => m.content))}`);
  });
});
