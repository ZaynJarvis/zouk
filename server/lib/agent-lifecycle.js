// Agent lifecycle: start/stop/reset-context routes + autoStartAgents.
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createAgentLifecycle(). No implicit closure captures.

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");

function createAgentLifecycle(ctx) {
  const router = Router();

  async function startAgentOnDaemon(id, config) {
    const {
      store, agentConfigs, db, agentAuth,
      daemonConnections, daemonSockets,
      normalizeWorkspaceId, DEFAULT_WORKSPACE_ID,
      validateCustomLauncher, decodeOvKey,
      isOvEnabledForAgent, isOvMcpEnabledForAgent, isOvPluginForAgent,
      resolveProvisioningCreds, resolveInitialOvUserId,
      resolveAgentOvCreds,
      OPENVIKING_URL, OPENVIKING_ACCOUNT,
      provisionAgentKey,
      buildRuntimeAgent, agentPayload, sanitizedAgentConfigs,
      broadcastToWeb, workspaceIdFromAgent,
      saveAgentConfigs,
      PUBLIC_URL,
      promptEngine, generateToolDefinitions, fetchOvTools,
      profilePresets, seedAgentIntoRegularChannels,
      pendingContextResets,
      ovLifecycle,
      machines,
    } = ctx;

    const runtime = config.runtime || "claude";
    const workspaceId = normalizeWorkspaceId(config.workspaceId || DEFAULT_WORKSPACE_ID);
    const requestedMachineId = typeof config.machineId === "string" && config.machineId.trim()
      ? config.machineId.trim()
      : undefined;
    const requestedWorkDir = typeof config.workDir === "string" && config.workDir.trim()
      ? config.workDir.trim()
      : undefined;

    // Normalize / validate the launcher override up-front so we never spawn an
    // agent with an invalid value, and so the persisted row matches what the
    // daemon receives. Empty / whitespace coerces to no override.
    if (config.customLauncher !== undefined) {
      const r = validateCustomLauncher(config.customLauncher, runtime);
      if (!r.ok) return { error: r.err };
      if (r.value === null) delete config.customLauncher;
      else config.customLauncher = r.value;
    }

    // Never spill a machine-pinned agent onto another host. That switches the
    // workspace underneath the server's saved config.
    let targetWs = null;
    if (requestedMachineId) {
      for (const ws of daemonConnections) {
        if (ws.readyState === 1 && ws._machineId === requestedMachineId) {
          targetWs = ws;
          break;
        }
      }
      if (!targetWs) {
        return { error: `Requested machine ${requestedMachineId} is not connected` };
      }
      if (!targetWs._runtimes?.includes(runtime)) {
        return { error: `Requested machine ${requestedMachineId} does not support runtime ${runtime}` };
      }
    } else {
      for (const ws of daemonConnections) {
        if (ws.readyState === 1 && ws._runtimes?.includes(runtime)) {
          targetWs = ws;
          break;
        }
      }
    }
    if (!targetWs) return { error: "No daemon connected with the requested runtime" };

    // Register agent in store — buildRuntimeAgent reads from agentConfigs first,
    // then falls back to the request payload for fields not yet persisted.
    store.agents[id] = buildRuntimeAgent(id, {
      workspaceId,
      runtime,
      model: config.model,
      workDir: requestedWorkDir,
      status: "starting",
      machineId: targetWs._machineId,
    });

    // OpenViking creds: gated on the per-agent `openvikingEnabled` toggle. When
    // disabled (default for non-whitelisted runtimes), skip provisioning and
    // never hand creds to the daemon — even custom-mode creds are withheld.
    const ovEnabled = isOvEnabledForAgent({ openvikingEnabled: config.openvikingEnabled, runtime });
    const ovMode = config.openvikingMode === 'custom' ? 'custom' : 'provisioned';
    // Derive user_id: existing rows keep whatever's already on disk (cannot move
    // OV memory of a previously-provisioned agent). New rows default to the
    // immutable Zouk agent id. The explicit openvikingUseAgentNameAsUser option
    // switches new provisioned rows to the name-based clone-sharing namespace.
    let ovUserId = config.openvikingUserId || resolveInitialOvUserId(config, id);
    let ovApiKey = config.openvikingApiKey || null;
    // URL pinning: existing rows keep whatever they're already on (pre-PR keys
    // have openvikingUrl=null → fall back to env so they never silently migrate
    // when a workspace admin enables a different URL). Newly-minted keys below
    // capture the URL they were minted under.
    let ovUrl = config.openvikingUrl || (ovApiKey ? OPENVIKING_URL : null);
    let daemonOv = null;

    if (!ovEnabled) {
      console.log(`[ov] skipping creds for ${id} (runtime=${runtime}, openvikingEnabled=false)`);
      // Leave ovApiKey alone — DB-persisted keys for previously-enabled agents
      // remain latent so flipping the toggle back on doesn't require re-provision.
    } else if (ovMode === 'provisioned' && !ovApiKey) {
      // Provisioned mode without a key yet — mint one. (Custom mode brings its
      // own URL+key, and existing provisioned agents already have a key.)
      const provCreds = resolveProvisioningCreds(workspaceId);
      if (provCreds) {
        try {
          const res = await provisionAgentKey({
            url: provCreds.url,
            account: provCreds.account,
            rootApiKey: provCreds.rootApiKey,
            agentId: ovUserId,
          });
          ovApiKey = res.user_key;
          ovUserId = res.user_id;
          ovUrl = provCreds.url; // pin the URL this key was minted under.
          console.log(`[ov] provisioned key for ${id} (user=${ovUserId}, source=${provCreds.source})`);
        } catch (err) {
          console.warn(`[ov] provisioning failed for ${id} (source=${provCreds.source}): ${err.message}`);
        }
      } else {
        console.warn(`[ov] no provisioning creds for ${id} (workspace=${workspaceId})`);
      }
    }

    // Resolve effective creds via the shared mode-aware resolver — same path
    // the runtime proxy + lifecycle use, so what we hand to the daemon matches
    // what those will reach for. Pass a synthetic config that reflects any
    // freshly-minted key (which isn't persisted to `config` yet).
    if (ovEnabled) {
      const synthetic = {
        ...config,
        id,
        openvikingApiKey: ovApiKey || config.openvikingApiKey || null,
        openvikingUrl: ovUrl || config.openvikingUrl || null,
        openvikingUserId: ovUserId || config.openvikingUserId || null,
      };
      const resolved = resolveAgentOvCreds(synthetic);
      if (resolved) {
        daemonOv = {
          url: resolved.url,
          account: resolved.account,
          userId: resolved.userId,
          apiKey: resolved.apiKey,
        };
        ovUrl = resolved.url; // make sure it gets persisted below.
        console.log(`[ov] daemon creds ready for ${id} (source=${resolved.source}, url=${resolved.url}, user=${resolved.userId})`);
      } else {
        console.warn(`[ov] no daemon creds for ${id} (mode=${ovMode}, hasKey=${!!ovApiKey})`);
      }
    }

    // Force-commit any leftover pending session from a previous run before
    // we (re)start this agent. Catches the case where the prior daemon
    // crashed mid-conversation and never sent inactive — content was sitting
    // in OV's pending buffer and would only roll into an archive on next
    // turn's auto-commit threshold.
    if (daemonOv && !isOvPluginForAgent(config) && ovLifecycle) {
      ovLifecycle.commitSession(id).catch(() => {});
    }

    // Issue a stable per-agent token. For new agents, DB persistence is
    // deferred until after saveAgentConfig to satisfy the FK constraint.
    const isNewAgent = !agentConfigs.some((c) => c.id === id);
    const agentToken = await agentAuth.issue(id, workspaceId, { skipDb: isNewAgent });

    const daemonConfig = {
      runtime,
      model: config.model,
      systemPrompt: config.systemPrompt || config.description || "",
      serverUrl: PUBLIC_URL,
      authToken: agentToken,
      name: config.name || id,
      displayName: config.displayName || config.name || id,
      description: config.description || "",
      lifecycle: config.lifecycle === 'ephemeral' ? 'ephemeral' : 'persistent',
    };
    if (requestedWorkDir) daemonConfig.workDir = requestedWorkDir;
    const cachedSessionId = store.agents[id]?.sessionId;
    if (cachedSessionId) daemonConfig.sessionId = cachedSessionId;
    if (config.envVars && typeof config.envVars === 'object') {
      daemonConfig.envVars = config.envVars;
    }
    // Route daemon-side OV traffic through zouk-server's /ov proxy:
    // daemon authenticates with its agent token, server swaps in the real OV
    // creds. Daemon never needs to reach OV directly (in Docker deployments
    // the OV container is internal-network-only).
    if (daemonOv) {
      daemonConfig.openviking = {
        url: `${PUBLIC_URL.replace(/\/+$/, "")}/ov`,
        account: daemonOv.account,
        userId: daemonOv.userId,
        apiKey: agentToken,
      };
    }
    if (isOvMcpEnabledForAgent(config)) daemonConfig.ovMcpEnabled = true;
    // Mute any host-installed OV plugin in the spawned agent process unless
    // the agent has explicitly opted out of this protection.
    daemonConfig.disableLocalOvPlugin = config.disableLocalOvPlugin !== false;
    if (config.customLauncher) daemonConfig.customLauncher = config.customLauncher;

    // v2: generate tool definitions (chat tools) + inject OV tools from /mcp
    const hasOv = !!daemonOv;
    const toolDefs = generateToolDefinitions({ tools: null, hasOv });
    if (hasOv && fetchOvTools) {
      try {
        const ovTools = await fetchOvTools(daemonOv);
        for (const t of ovTools) {
          // Namespace OV tools to avoid collisions with chat tools and to make
          // the source obvious in the agent's tool list.
          const prefixed = { ...t, name: `openviking_${t.name}` };
          if (!toolDefs.some((existing) => existing.name === prefixed.name)) toolDefs.push(prefixed);
        }
      } catch (err) {
        console.warn(`[ov-mcp] fetchOvTools failed for ${id}: ${err.message}`);
      }
    }
    const { assembled: systemPromptV2, sections: promptSections } = promptEngine.assemble({
      name: daemonConfig.name,
      displayName: daemonConfig.displayName,
      workspaceName: workspaceId,
      workDir: requestedWorkDir || `~/.zouk/agents/${id}`,
      instructions: config.description || config.systemPrompt || "",
      toolDefinitions: toolDefs.filter((t) => !t.local),
      hasOv,
      hasOvTools: hasOv,
    });

    // OV startup context injection for managed agents (best-effort, non-blocking start)
    let ovStartupBlock = null;
    if (hasOv && !isOvPluginForAgent(config) && ovLifecycle) {
      try {
        ovStartupBlock = await ovLifecycle.getStartupContext(id);
      } catch (err) {
        console.warn(`[ov] startup context failed for ${id}: ${err.message}`);
      }
    }
    if (ovStartupBlock) {
      promptSections.push({ id: "ov_context", content: ovStartupBlock, priority: 85 });
    }
    const finalAssembled = ovStartupBlock
      ? systemPromptV2 + "\n\n---\n\n" + ovStartupBlock
      : systemPromptV2;

    // Send agent:start to daemon with v2 fields alongside v1 fields for compat.
    targetWs.send(JSON.stringify({
      type: "agent:start",
      agentId: id,
      launchId: uuidv4(),
      config: daemonConfig,
      // v2 fields — daemon can use these if it supports them
      prompt: { sections: promptSections, assembled: finalAssembled },
      toolDefinitions: toolDefs,
    }));

    daemonSockets.set(id, targetWs);

    // Upsert into agentConfigs BEFORE broadcasting so that agentPayload()
    // can overlay the authoritative config onto the runtime entry.
    const existingIdx = agentConfigs.findIndex((c) => c.id === id);
    if (existingIdx < 0) {
      const persisted = {
        id,
        workspaceId,
        name: config.name || id,
        displayName: config.displayName || config.name || id,
        description: config.description || "",
        systemPrompt: config.systemPrompt || config.description || "",
        runtime,
        model: config.model,
        machineId: targetWs._machineId,
        autoStart: true,
        lifecycle: config.lifecycle === 'ephemeral' ? 'ephemeral' : 'persistent',
      };
      if (requestedWorkDir) persisted.workDir = requestedWorkDir;
      if (config.envVars && typeof config.envVars === 'object') persisted.envVars = config.envVars;
      if (config.customLauncher) persisted.customLauncher = config.customLauncher;
      if (typeof config.openvikingEnabled === 'boolean') {
        persisted.openvikingEnabled = config.openvikingEnabled;
      }
      if (typeof config.ovMcpEnabled === 'boolean') {
        persisted.ovMcpEnabled = config.ovMcpEnabled;
      }
      // Default true; only persist false (the opt-out) explicitly. true is
      // already the column default so leaving it off keeps the row compact.
      if (config.disableLocalOvPlugin === false) {
        persisted.disableLocalOvPlugin = false;
      }
      if (config.openvikingUseAgentNameAsUser === true) {
        persisted.openvikingUseAgentNameAsUser = true;
      }
      if (ovApiKey) {
        persisted.openvikingApiKey = ovApiKey;
        if (ovUrl) persisted.openvikingUrl = ovUrl;
      }
      // Canonical OV ids for new agents: the bare handle, persisted + frozen.
      // (Existing agents never reach this new-agent block, so their legacy
      // zouk-<id> user_id / zouk-<agentId> session_id fall-throughs are
      // untouched — their OV memory is never orphaned.)
      if (ovUserId) {
        persisted.openvikingUserId = ovUserId;
        persisted.openvikingSessionId = ovUserId;
      }
      const usedImages = new Set(agentConfigs.filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId).map((c) => c.picture).filter(Boolean));
      const shardedPicture = profilePresets.pickForAgent(id, usedImages, workspaceId);
      if (shardedPicture) persisted.picture = shardedPicture;
      agentConfigs.push(persisted);
      saveAgentConfigs(agentConfigs);
      db.saveAgentConfig(persisted);
      agentAuth.persistToken(id).catch((e) => console.warn(`[auth] persistToken ${id}: ${e.message}`));
      // New agent → subscribe to every regular (non-DM) channel so the legacy
      // "visible everywhere by default" behavior is preserved. Humans can
      // unsubscribe via the /subscriptions API.
      seedAgentIntoRegularChannels(id);
    } else if (ovApiKey && !agentConfigs[existingIdx].openvikingApiKey) {
      // Backfill an existing keyless agent. machineId is immutable — leave it.
      agentConfigs[existingIdx].openvikingUserId = ovUserId;
      agentConfigs[existingIdx].openvikingApiKey = ovApiKey;
      if (ovUrl) agentConfigs[existingIdx].openvikingUrl = ovUrl;
      saveAgentConfigs(agentConfigs);
      db.saveAgentConfig(agentConfigs[existingIdx]);
    }
    // Existing configs: machineId is immutable — no rewrite on restart.

    broadcastToWeb({ type: "agent_started", workspaceId, agent: agentPayload(id) });
    broadcastToWeb({
      type: "config_updated",
      workspaceId,
      configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId),
    });
    console.log(`[api] Starting agent ${id} (runtime: ${runtime}) on daemon`);
    return { agentId: id, status: "starting" };
  }

  // Start all auto-start agents (called when daemon connects)
  async function autoStartAgents() {
    const { agentConfigs, store } = ctx;
    const autoStart = agentConfigs.filter((c) => c.autoStart);
    for (const config of autoStart) {
      if (store.agents[config.id]?.status === "active") continue;
      const result = await startAgentOnDaemon(config.id, config);
      if (result.error) {
        const agentName = config.displayName || config.name || config.id;
        console.log(`[auto-start] Failed to start ${agentName} (${config.id}): ${result.error}`);
      }
    }
  }

  // Start an agent
  router.post("/api/agents/start", ctx.requireAuth, async (req, res) => {
    const config = req.body;
    const workspaceId = req.workspaceId || ctx.DEFAULT_WORKSPACE_ID;
    const id = config.agentId || config.id || `agent-${uuidv4().substring(0, 8)}`;

    // If starting from a saved config, look it up. machineId on a saved config
    // is immutable, so the request body's machineId is ignored when one exists.
    const savedConfig = ctx.agentConfigs.find((c) => c.id === id);
    if (savedConfig && (savedConfig.workspaceId || ctx.DEFAULT_WORKSPACE_ID) !== workspaceId) {
      return res.status(404).json({ error: "Agent not found" });
    }
    const mergedConfig = { ...savedConfig, ...config };
    mergedConfig.workspaceId = workspaceId;
    if (savedConfig?.machineId) mergedConfig.machineId = savedConfig.machineId;

    if (savedConfig) {
      // Handle is immutable — never let the start payload rewrite it.
      mergedConfig.name = savedConfig.name;
    } else {
      // New agent: the handle becomes the immutable, OV-backing canonical name.
      const name = typeof mergedConfig.name === "string" ? mergedConfig.name.trim() : "";
      if (!ctx.isValidAgentHandle(name)) {
        return res.status(400).json({ error: "Agent name must be 1-48 chars: lowercase letters, digits, - or _, starting with a letter or digit" });
      }
      if (ctx.isReservedName(name)) {
        return res.status(400).json({ error: `Agent name "${name}" is reserved` });
      }
      if (ctx.isAgentNameTaken(name, id)) {
        return res.status(409).json({ error: `Agent name "${name}" is already taken` });
      }
      mergedConfig.name = name;
    }

    if (ctx.store.agents[id] && ctx.store.agents[id].status === "active") {
      return res.status(400).json({ error: `Agent ${id} is already running` });
    }

    const result = await startAgentOnDaemon(id, mergedConfig);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  });

  // Stop an agent
  router.post("/api/agents/:id/stop", ctx.requireAuth, (req, res) => {
    const { id } = req.params;
    const workspaceId = req.workspaceId || ctx.DEFAULT_WORKSPACE_ID;
    if (ctx.workspaceIdFromAgent(id) !== workspaceId) return res.status(404).json({ error: "Agent not found" });
    const ws = ctx.daemonSockets.get(id);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "agent:stop", agentId: id }));
    }
    if (ctx.store.agents[id]) {
      ctx.normalizeInactiveAgentState(id, "stopping");
      ctx.broadcastAgentStatus(id, "stopping", workspaceId);
    }
    console.log(`[api] Stopping agent ${id}`);
    res.json({ success: true });
  });

  // Reset an agent's conversation context: SIGTERM the running process, wait for
  // it to exit, then cold-start with a null session_id. Workspace is preserved.
  router.post("/api/agents/:id/reset-context", ctx.requireAuth, async (req, res) => {
    const { id } = req.params;
    const workspaceId = req.workspaceId || ctx.DEFAULT_WORKSPACE_ID;
    const savedConfig = ctx.agentConfigs.find((c) => c.id === id);
    if (!savedConfig) return res.status(404).json({ error: "agent not found" });
    if ((savedConfig.workspaceId || ctx.DEFAULT_WORKSPACE_ID) !== workspaceId) return res.status(404).json({ error: "agent not found" });

    const ws = ctx.daemonSockets.get(id);
    const isActive = ctx.store.agents[id]?.status === "active";

    if (isActive && ws && ws.readyState === 1) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          ctx.pendingContextResets.delete(id);
          resolve();
        }, 3000);
        ctx.pendingContextResets.set(id, () => {
          clearTimeout(timer);
          resolve();
        });
        ws.send(JSON.stringify({ type: "agent:stop", agentId: id }));
        if (ctx.store.agents[id]) {
          ctx.normalizeInactiveAgentState(id, "stopping");
          ctx.broadcastAgentStatus(id, "stopping", workspaceId);
        }
      });
    }

    const result = await startAgentOnDaemon(id, savedConfig);
    if (result.error) return res.status(400).json(result);
    console.log(`[api] Context reset for agent ${id}`);
    res.json({ success: true });
  });

  return { startAgentOnDaemon, autoStartAgents, router };
}

module.exports = { createAgentLifecycle };
