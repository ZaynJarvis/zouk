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
    assert.ok(result.name.startsWith(parentName + "-c"), "clone name should have -cN suffix");

    // Verify daemon received agent:start for the clone
    const startEvt = await daemon.waitForStart(result.cloneId, 2000);
    assert.ok(startEvt, "daemon should receive agent:start for clone");
    assert.equal(startEvt.config.workDir, "/home/zeus/workspace", "clone should share parent's workDir");
    assert.equal(startEvt.config.lifecycle, "ephemeral", "clone should be ephemeral");
    assert.ok(startEvt.config.name.startsWith(parentName + "-c"), "clone daemon config should have -cN name");

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

    // Send a DM to the clone
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
    // Create 4 clones (the max)
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

  it("name allocation dodges an existing same-name agent", async () => {
    // Pre-create an agent with the name that clone #1 would normally get
    await sim.createAgentConfig({
      id: "agent-other",
      name: "zeus-c1",
      displayName: "Other Agent",
      runtime: "claude",
      model: "sonnet",
      machineId: machineKeyId,
      workDir: "/tmp/other",
    });

    // Clone the parent — should skip -c1 (taken) and use -c2
    const result = await sim.post(`/api/agents/${parentId}/clone`, {}, { token: sim.rootToken });
    assert.ok(result.name, "clone should have a name");
    assert.equal(result.name, "zeus-c2", "clone should use -c2 since -c1 is taken");
    assert.equal(result.cloneId, parentId + "-c2", "cloneId should use -c2 suffix");
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
});
