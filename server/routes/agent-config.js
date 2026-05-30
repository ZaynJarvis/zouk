// Agent config CRUD + Profile presets + Machine key management routes.
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createAgentConfigRouter(). No implicit closure captures.

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");

function createAgentConfigRouter(ctx) {
  const router = Router();

  const {
    requireAuth, requireWorkspaceRead,
    store, db, agentConfigs,
    machineKeys, machines, daemonConnections,
    DEFAULT_WORKSPACE_ID,
    agentPayload, broadcastToWeb, sanitizedAgentConfigs,
    saveAgentConfigs, saveMachineKeys,
    workspaceIdFromAgent,
    agentAuth, purgeAgentMemberships, purgeUnknownAgentState,
    validateCustomLauncher, isOvEnabledForAgent, isPersistentMachineId,
    isValidAgentHandle, isAgentNameTaken, isReservedName,
    profilePresets, PROFILE_PRESET_MAX,
    generateApiKey, now,
  } = ctx;

  // Mirror config fields that also live on the runtime agent record. Without
  // this, edits land in agentConfigs (and the DB) but the live `store.agents`
  // keeps the old values until the next server restart — so the sidebar / detail
  // header keep showing the pre-rename name even though the user clicked SAVE.
  function syncRuntimeAgentFromConfig(id, config) {
    const a = store.agents[id];
    if (!a) return false;
    let changed = false;
    if (config.name !== undefined && config.name !== a.name) { a.name = config.name; changed = true; }
    if (config.displayName !== undefined && config.displayName !== a.displayName) { a.displayName = config.displayName; changed = true; }
    if (config.runtime !== undefined && config.runtime !== a.runtime) { a.runtime = config.runtime; changed = true; }
    if (config.model !== undefined && config.model !== a.model) { a.model = config.model; changed = true; }
    if (config.workDir !== undefined && config.workDir !== a.workDir) { a.workDir = config.workDir; changed = true; }
    if (config.picture !== undefined && config.picture !== a.picture) { a.picture = config.picture; changed = true; }
    return changed;
  }

  // ─── Agent config CRUD ───────────────────────────────────────────

  // List all agent configs
  router.get("/agent-configs", requireWorkspaceRead, (req, res) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    res.json({
      configs: sanitizedAgentConfigs().filter((config) => (
        (config.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
      )),
    });
  });

  // Create/save agent config
  router.post("/agent-configs", requireAuth, (req, res) => {
    const config = req.body;
    config.workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    if (!config.id) config.id = `agent-${uuidv4().substring(0, 8)}`;
    const existing = agentConfigs.findIndex((c) => c.id === config.id);
    if (existing >= 0 && (agentConfigs[existing].workspaceId || DEFAULT_WORKSPACE_ID) !== config.workspaceId) {
      return res.status(404).json({ error: "Agent not found" });
    }
    if (config.customLauncher !== undefined) {
      const r = validateCustomLauncher(config.customLauncher, config.runtime);
      if (!r.ok) return res.status(400).json({ error: r.err });
      config.customLauncher = r.value; // null = drop the field on disk
      if (r.value === null) delete config.customLauncher;
    }
    if (existing >= 0) {
      // machineId and name are immutable — never let the payload overwrite the
      // stored values (name backs the agent's OV namespace, frozen at creation).
      const { machineId: _ignored, name: _ignoredName, ...rest } = config;
      agentConfigs[existing] = { ...agentConfigs[existing], ...rest };
    } else {
      if (!config.machineId) return res.status(400).json({ error: "machineId is required" });
      if (!isPersistentMachineId(config.machineId, config.workspaceId)) return res.status(400).json({ error: "machineId does not match any machine key" });
      // Validate the canonical handle: slug-shaped, not reserved, unique within
      // the workspace. It becomes the agent's immutable @mention handle and OV
      // user/session id.
      const name = typeof config.name === "string" ? config.name.trim() : "";
      if (!isValidAgentHandle(name)) {
        return res.status(400).json({ error: "Agent name must be 1-48 chars: lowercase letters, digits, - or _, starting with a letter or digit" });
      }
      if (isReservedName(name)) {
        return res.status(400).json({ error: `Agent name "${name}" is reserved` });
      }
      if (isAgentNameTaken(name, config.id, config.workspaceId)) {
        return res.status(409).json({ error: `Agent name "${name}" is already taken` });
      }
      config.name = name;
      agentConfigs.push(config);
    }
    const saved = agentConfigs.find((c) => c.id === config.id);
    saveAgentConfigs(agentConfigs);
    db.saveAgentConfig(saved);
    if (syncRuntimeAgentFromConfig(saved.id, saved)) {
      broadcastToWeb({ type: "agent_started", workspaceId: saved.workspaceId || DEFAULT_WORKSPACE_ID, agent: agentPayload(saved.id) });
    }
    broadcastToWeb({
      type: "config_updated",
      workspaceId: saved.workspaceId || DEFAULT_WORKSPACE_ID,
      configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === (saved.workspaceId || DEFAULT_WORKSPACE_ID)),
    });
    res.json({ config: saved });
  });

  // Update agent config (upsert: creates config from running agent if none exists)
  router.put("/agents/:id/config", requireAuth, (req, res) => {
    const { id } = req.params;
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const updates = req.body;
    let idx = agentConfigs.findIndex((c) => c.id === id);
    if (idx >= 0 && (agentConfigs[idx].workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) {
      return res.status(404).json({ error: "Agent not found" });
    }
    if (idx < 0) {
      const running = store.agents[id];
      if (!running) return res.status(404).json({ error: "Agent not found" });
      if (!running.machineId) return res.status(400).json({ error: "Running agent has no machineId" });
      agentConfigs.push({
        id,
        workspaceId,
        name: running.name,
        displayName: running.displayName,
        runtime: running.runtime,
        model: running.model,
        workDir: running.workDir,
        machineId: running.machineId,
      });
      idx = agentConfigs.length - 1;
    }
    // machineId and name are immutable. name backs the agent's OV namespace
    // (frozen at creation). openvikingApiKey / openvikingUserId are
    // server-managed (provisioned by the agent-start handler); never let the
    // payload overwrite any of them.
    const {
      machineId: _ignoredMachineId,
      name: _ignoredName,
      openvikingApiKey: _ignoredOvApiKey,
      openvikingUserId: _ignoredOvUserId,
      openvikingCustomApiKey: incomingCustomApiKey,
      openvikingMode: incomingMode,
      openvikingEnabled: incomingEnabled,
      ovMcpEnabled: incomingOvMcpEnabled,
      ovLifecycleMode: incomingOvLifecycleMode,
      disableLocalOvPlugin: incomingDisableLocalOvPlugin,
      customLauncher: incomingLauncher,
      ...rest
    } = updates;

    const merged = { ...agentConfigs[idx], ...rest };
    merged.workspaceId = workspaceId;

    // customLauncher: per-agent override of the daemon driver's default binary.
    // "Leave blank = clear" semantics (it's not a secret, so what-you-see is
    // what's saved — differs from the OV API key field's "leave blank = keep").
    if (incomingLauncher !== undefined) {
      const r = validateCustomLauncher(incomingLauncher, merged.runtime);
      if (!r.ok) return res.status(400).json({ error: r.err });
      merged.customLauncher = r.value; // null clears the field, string sets it
    }

    // openvikingEnabled: boolean = explicit override; null = clear to follow
    // the runtime default; undefined = leave as-is.
    if (incomingEnabled === null) {
      delete merged.openvikingEnabled;
    } else if (typeof incomingEnabled === 'boolean') {
      merged.openvikingEnabled = incomingEnabled;
    }
    // ovMcpEnabled: same tri-state as openvikingEnabled.
    if (incomingOvMcpEnabled === null) {
      delete merged.ovMcpEnabled;
    } else if (typeof incomingOvMcpEnabled === 'boolean') {
      merged.ovMcpEnabled = incomingOvMcpEnabled;
    }

    // ovLifecycleMode: "managed" (server handles OV lifecycle) or "plugin"
    // (agent's own plugin handles it). null = clear to follow runtime default.
    if (incomingOvLifecycleMode === null) {
      delete merged.ovLifecycleMode;
    } else if (incomingOvLifecycleMode === 'managed' || incomingOvLifecycleMode === 'plugin') {
      merged.ovLifecycleMode = incomingOvLifecycleMode;
    }

    // disableLocalOvPlugin: boolean — default true (disable host's plugin).
    // Anything other than an explicit false is treated as true.
    if (typeof incomingDisableLocalOvPlugin === 'boolean') {
      merged.disableLocalOvPlugin = incomingDisableLocalOvPlugin;
    }

    // openvikingMode: clamp to known values; default unchanged.
    if (incomingMode !== undefined) {
      merged.openvikingMode = incomingMode === 'custom' ? 'custom' : 'provisioned';
    }
    // openvikingCustomApiKey: empty string / undefined = keep old value (the
    // password-input "leave blank to keep" pattern). Non-empty string = replace.
    if (typeof incomingCustomApiKey === 'string' && incomingCustomApiKey.length > 0) {
      merged.openvikingCustomApiKey = incomingCustomApiKey;
    } else if (incomingCustomApiKey === null) {
      // Explicit null = clear the saved value.
      merged.openvikingCustomApiKey = null;
    }

    // Reject save if OV is enabled, mode is custom, and url/key aren't set.
    // When OV is disabled (toggle off), mode fields are inert so no validation
    // needed — user can stage custom creds without filling everything in.
    if (isOvEnabledForAgent(merged) && merged.openvikingMode === 'custom') {
      if (!merged.openvikingCustomUrl || !merged.openvikingCustomApiKey) {
        return res.status(400).json({
          error: "Custom OpenViking mode requires both openvikingCustomUrl and openvikingCustomApiKey",
        });
      }
    }

    agentConfigs[idx] = merged;
    // description is the system prompt — keep them in sync
    if (updates.description !== undefined && updates.systemPrompt === undefined) {
      agentConfigs[idx].systemPrompt = updates.description;
    }
    saveAgentConfigs(agentConfigs);
    db.saveAgentConfig(agentConfigs[idx]);
    if (syncRuntimeAgentFromConfig(id, agentConfigs[idx])) {
      broadcastToWeb({ type: "agent_started", workspaceId, agent: agentPayload(id) });
    }
    broadcastToWeb({
      type: "config_updated",
      workspaceId,
      configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
    });
    // Strip secrets from the response too, so saving doesn't leak the api key
    // back to the client even though it's the same client that just sent it.
    const { openvikingApiKey: _stripA, openvikingCustomApiKey: _stripB, ...safeConfig } = agentConfigs[idx];
    res.json({
      config: {
        ...safeConfig,
        openvikingProvisioned: !!agentConfigs[idx].openvikingApiKey,
        openvikingCustomConfigured: !!agentConfigs[idx].openvikingCustomApiKey,
      },
    });
  });

  // Delete agent config
  router.delete("/agents/:id", requireAuth, (req, res) => {
    const { id } = req.params;
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    if (workspaceIdFromAgent(id) !== workspaceId) return res.status(404).json({ error: "Agent not found" });
    // Commit before deleting the config — otherwise the daemon's later
    // inactive event arrives at a config-less agent and the commit is
    // skipped, losing the last conversation segment.
    const dyingCfg = agentConfigs.find((c) => c.id === id);
    if (ctx.ovLifecycle && dyingCfg?.openvikingApiKey) {
      ctx.ovLifecycle.commitSession(id).catch(() => {});
    }
    ctx.sendAgentStop(id);
    const idx = agentConfigs.findIndex((c) => c.id === id);
    if (idx >= 0) {
      agentConfigs.splice(idx, 1);
      saveAgentConfigs(agentConfigs);
      db.deleteAgentConfig(id);
    }
    agentAuth.revoke(id);
    purgeAgentMemberships(id);
    purgeUnknownAgentState(id);
    broadcastToWeb({ type: "agent_status", workspaceId, agentId: id, status: "deleted" });
    broadcastToWeb({
      type: "config_updated",
      workspaceId,
      configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
    });
    res.json({ success: true });
  });

  // ─── Profile preset pool ────────────────────────────────────────

  router.get("/agent-profile-presets", requireWorkspaceRead, (req, res) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    res.json({ presets: profilePresets.list(workspaceId), count: profilePresets.count(workspaceId), max: PROFILE_PRESET_MAX });
  });

  router.post("/agent-profile-presets", requireAuth, async (req, res) => {
    const { image } = req.body || {};
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const result = await profilePresets.add(image, workspaceId);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ preset: result.preset, count: profilePresets.count(workspaceId), max: PROFILE_PRESET_MAX });
  });

  router.delete("/agent-profile-presets/:id", requireAuth, async (req, res) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const result = await profilePresets.remove(req.params.id, workspaceId);
    if (result.error) return res.status(404).json({ error: result.error });
    res.json({ success: true, count: profilePresets.count(workspaceId), max: PROFILE_PRESET_MAX });
  });

  // ─── Machine API key management ─────────────────────────────────

  // List machine API keys (masked)
  router.get("/machine-keys", requireAuth, (req, res) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const keys = machineKeys
      .filter((k) => !k.revokedAt && (k.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)
      .map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.rawKey.substring(0, 18),
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      }));
    res.json({ keys });
  });

  // Generate a new machine API key
  router.post("/machine-keys", requireAuth, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;

    const rawKey = generateApiKey();
    const keyRecord = {
      id: `mk-${uuidv4().substring(0, 8)}`,
      workspaceId,
      name,
      rawKey,
      createdAt: now(),
      lastUsedAt: null,
      revokedAt: null,
      boundFingerprint: null,
    };
    machineKeys.push(keyRecord);
    saveMachineKeys(machineKeys);
    await db.saveMachineKey(keyRecord);
    console.log(`[keys] Generated machine key "${name}" (${rawKey.substring(0, 18)}...)`);

    res.json({
      key: {
        id: keyRecord.id,
        name: keyRecord.name,
        keyPrefix: rawKey.substring(0, 18),
        createdAt: keyRecord.createdAt,
        lastUsedAt: keyRecord.lastUsedAt,
      },
      rawKey,
    });
  });

  // Delete a machine API key — cascades to agent_configs bound to this machine.
  router.delete("/machine-keys/:id", requireAuth, async (req, res) => {
    const { id } = req.params;
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const idx = machineKeys.findIndex((k) => k.id === id && (k.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId);
    if (idx < 0) return res.status(404).json({ error: "Key not found" });
    const key = machineKeys[idx];

    // Cascade: collect agents bound to this machine, stop them, purge state.
    const orphanedAgentIds = agentConfigs
      .filter((c) => c.machineId === id && (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId)
      .map((c) => c.id);
    for (const agentId of orphanedAgentIds) {
      sendAgentStop(agentId);
      purgeUnknownAgentState(agentId);
      broadcastToWeb({ type: "agent_status", agentId, status: "deleted" });
    }
    for (let i = agentConfigs.length - 1; i >= 0; i--) {
      if (agentConfigs[i].machineId === id && (agentConfigs[i].workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId) {
        agentConfigs.splice(i, 1);
      }
    }
    saveAgentConfigs(agentConfigs);

    // Remove the key itself. The DB has ON DELETE CASCADE, so agent_configs
    // rows in Postgres are removed by the FK — we don't need deleteAgentConfig.
    machineKeys.splice(idx, 1);
    saveMachineKeys(machineKeys);
    await db.deleteMachineKey(id);

    // Drop any live daemon connection authenticated with this key.
    for (const dws of daemonConnections) {
      if (dws._machineId === id) {
        try { dws.close(1008, "machine key deleted"); } catch {}
      }
    }
    machines.delete(id);
    broadcastToWeb({ type: "machine:disconnected", workspaceId, machineId: id });
    broadcastToWeb({
      type: "config_updated",
      workspaceId,
      configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
    });
    console.log(`[keys] Deleted machine key "${key.name}" (cascaded ${orphanedAgentIds.length} agent config(s))`);
    res.json({ success: true });
  });

  return { router, syncRuntimeAgentFromConfig };
}

module.exports = { createAgentConfigRouter };
