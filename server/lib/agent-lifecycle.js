// Agent lifecycle: start/stop/reset-context routes + autoStartAgents.
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createAgentLifecycle(). No implicit closure captures.

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");

function createAgentLifecycle(ctx) {
  const router = Router();

  async function startAgentOnDaemon(id, config, options = {}) {
    const {
      store, agentConfigs, db, agentAuth,
      daemonConnections, daemonSockets,
      normalizeWorkspaceId, DEFAULT_WORKSPACE_ID,
      validateCustomLauncher, decodeOvKey,
      isOvEnabledForAgent, isOvMcpEnabledForAgent, isOvPluginForAgent,
      resolveProvisioningCreds, resolveInitialOvUserId,
      resolveAgentOvCreds,
      OPENVIKING_URL, OPENVIKING_ACCOUNT,
      provisionAgentKey, fetchExistingAgentKey,
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
    const resumeSession = options.resumeSession !== false;
    const cachedSessionId = resumeSession ? store.agents[id]?.sessionId : null;

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
      sessionId: cachedSessionId || undefined,
    });

    // OpenViking creds: gated on the per-agent `openvikingEnabled` toggle. When
    // disabled (default for non-whitelisted runtimes), skip provisioning and
    // never hand creds to the daemon — even custom-mode creds are withheld.
    const ovEnabled = isOvEnabledForAgent({ openvikingEnabled: config.openvikingEnabled, runtime });
    const ovMode = config.openvikingMode === 'custom' ? 'custom' : 'provisioned';
    // Derive user_id: existing rows keep whatever's already on disk (cannot move
    // OV memory of a previously-provisioned agent). New rows use the bare
    // canonical handle (agent name) as the OV user_id — see resolveInitialOvUserId.
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
          // 409 = an OV user with this id already exists. This happens when an
          // agent is recreated under a name a prior agent used (OV users aren't
          // deleted on agent delete). Reuse the existing user's key so the new
          // agent inherits the prior namespace's memory instead of running
          // keyless. Any other error is a hard failure — log and leave keyless.
          if (err.status === 409 && fetchExistingAgentKey) {
            try {
              const existingKey = await fetchExistingAgentKey({
                url: provCreds.url,
                account: provCreds.account,
                rootApiKey: provCreds.rootApiKey,
                agentId: ovUserId,
              });
              if (existingKey) {
                ovApiKey = existingKey;
                ovUrl = provCreds.url;
                console.log(`[ov] reused existing OV user key for ${id} (user=${ovUserId}, source=${provCreds.source}) — inherits prior memory`);
              } else {
                console.warn(`[ov] 409 for ${id} but no matching OV user '${ovUserId}' in account listing — leaving keyless`);
              }
            } catch (lookupErr) {
              console.warn(`[ov] 409 recovery failed for ${id} (user=${ovUserId}): ${lookupErr.message}`);
            }
          } else {
            console.warn(`[ov] provisioning failed for ${id} (source=${provCreds.source}): ${err.message}`);
          }
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
    if (cachedSessionId) daemonConfig.sessionId = cachedSessionId;
    else if (!resumeSession) daemonConfig.sessionId = null;
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
      await seedAgentIntoRegularChannels(id);
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
    // Skip clones (autoStart=false) and any agent with cloneOf set as a
    // belt-and-suspenders guard — clones must be explicitly started via the
    // clone API.
    const autoStart = agentConfigs.filter((c) => c.autoStart && !c.cloneOf);
    for (const config of autoStart) {
      const status = store.agents[config.id]?.status;
      if (status === "active" || status === "starting") continue;
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
      if (ctx.isAgentNameTaken(name, id, workspaceId)) {
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

  // ─── Clone agent ────────────────────────────────────────────────
  // Max live clones per parent. Clones are ephemeral helpers — cap keeps
  // resource usage bounded and prevents runaway fan-out.
  const MAX_CLONES_PER_PARENT = 4;

  function countLiveClonesOfParent(parentId, workspaceId) {
    const { agentConfigs, store } = ctx;
    const DEFAULT_WORKSPACE_ID = ctx.DEFAULT_WORKSPACE_ID;
    const normalizeWorkspaceId = ctx.normalizeWorkspaceId;
    const wsId = normalizeWorkspaceId(workspaceId || DEFAULT_WORKSPACE_ID);
    let count = 0;
    for (const cfg of agentConfigs) {
      if (cfg.cloneOf !== parentId) continue;
      if (normalizeWorkspaceId(cfg.workspaceId || DEFAULT_WORKSPACE_ID) !== wsId) continue;
      // Count configs that still exist (dissolved clones are removed from agentConfigs).
      // Also check the runtime store for active status.
      count++;
    }
    return count;
  }

  function allocateCloneIdentity(parentCfg, parentId, workspaceId) {
    const { agentConfigs, store } = ctx;
    const DEFAULT_WORKSPACE_ID = ctx.DEFAULT_WORKSPACE_ID;
    const normalizeWorkspaceId = ctx.normalizeWorkspaceId;
    const isAgentNameTaken = ctx.isAgentNameTaken;
    const wsId = normalizeWorkspaceId(workspaceId || DEFAULT_WORKSPACE_ID);
    const parentName = parentCfg.name || parentId;

    // Collect existing clone numbers for this parent.
    // Recognize both the current ".N" scheme and the legacy "-cN" scheme so
    // nothing breaks if old clones still exist on disk.
    const usedNumbers = new Set();
    const cloneNumRe = /(?:\.|-c)(\d+)$/;
    for (const cfg of agentConfigs) {
      if (cfg.cloneOf !== parentId) continue;
      if (normalizeWorkspaceId(cfg.workspaceId || DEFAULT_WORKSPACE_ID) !== wsId) continue;
      const match = (cfg.name || "").match(cloneNumRe);
      if (match) usedNumbers.add(parseInt(match[1], 10));
    }
    // Also check running agents
    for (const [id, a] of Object.entries(store.agents)) {
      const cfg = agentConfigs.find((c) => c.id === id);
      if (cfg?.cloneOf !== parentId) continue;
      const match = (a.name || id).match(cloneNumRe);
      if (match) usedNumbers.add(parseInt(match[1], 10));
    }

    // Find the first unused number starting from 2 (zeus.2 is the first clone
    // — the parent is implicitly "zeus.1"). Dodge collisions with ANY agent
    // name, not just other clones.
    let cloneNum = 2;
    while (usedNumbers.has(cloneNum) || isAgentNameTaken(`${parentName}.${cloneNum}`, null, workspaceId)) {
      cloneNum++;
    }

    const cloneName = `${parentName}.${cloneNum}`;
    const cloneId = `${parentId}.${cloneNum}`;

    return { cloneName, cloneId, cloneNum };
  }

  async function cloneAgent(parentId, options = {}) {
    const {
      store, agentConfigs, db, agentAuth,
      daemonConnections, daemonSockets,
      normalizeWorkspaceId, DEFAULT_WORKSPACE_ID,
      agentPayload, sanitizedAgentConfigs,
      broadcastToWeb, workspaceIdFromAgent,
      saveAgentConfigs,
      agentAuth: { revoke: revokeToken },
      purgeAgentMemberships, purgeUnknownAgentState,
    } = ctx;

    const workspaceId = normalizeWorkspaceId(options.workspaceId || DEFAULT_WORKSPACE_ID);

    // Find parent config
    const parentCfg = agentConfigs.find((c) => c.id === parentId);
    if (!parentCfg) return { error: "Parent agent not found", status: 404 };
    if (normalizeWorkspaceId(parentCfg.workspaceId || DEFAULT_WORKSPACE_ID) !== workspaceId) {
      return { error: "Parent agent not found", status: 404 };
    }

    // Reject clones of clones
    if (parentCfg.cloneOf) {
      return { error: "Cannot clone a clone. Clone the original agent instead.", status: 400 };
    }

    // Enforce cap
    const liveClones = countLiveClonesOfParent(parentId, workspaceId);
    if (liveClones >= MAX_CLONES_PER_PARENT) {
      return {
        error: `Maximum ${MAX_CLONES_PER_PARENT} clones per agent already running`,
        status: 409,
      };
    }

    // Allocate identity
    const { cloneName, cloneId, cloneNum } = allocateCloneIdentity(parentCfg, parentId, workspaceId);

    // Build clone config: share identity assets, fresh instance fields
    const cloneConfig = {
      id: cloneId,
      workspaceId,
      name: cloneName,
      displayName: `${parentCfg.displayName || parentCfg.name || parentId} (clone ${cloneNum})`,
      description: parentCfg.description || "",
      systemPrompt: parentCfg.systemPrompt || parentCfg.description || "",
      runtime: parentCfg.runtime || "claude",
      model: parentCfg.model,
      machineId: parentCfg.machineId,
      workDir: parentCfg.workDir,
      autoStart: false,
      lifecycle: "ephemeral",
      cloneOf: parentId,
      // Shared OV identity: same user_id + api_key = same memory namespace.
      // The ov-mcp proxy keys sessions per apiKey+user, so committed archives
      // are shared; the clone's openvikingSessionId suffix keeps its pending
      // buffer isolated from the parent.
      openvikingEnabled: parentCfg.openvikingEnabled,
      openvikingUserId: parentCfg.openvikingUserId,
      openvikingApiKey: parentCfg.openvikingApiKey,
      openvikingUrl: parentCfg.openvikingUrl,
      openvikingSessionId: parentCfg.openvikingSessionId
        ? `${parentCfg.openvikingSessionId}-c${cloneNum}`
        : undefined,
      openvikingMode: parentCfg.openvikingMode,
      openvikingCustomUrl: parentCfg.openvikingCustomUrl,
      openvikingCustomApiKey: parentCfg.openvikingCustomApiKey,
      ovMcpEnabled: parentCfg.ovMcpEnabled,
      ovLifecycleMode: parentCfg.ovLifecycleMode,
      disableLocalOvPlugin: parentCfg.disableLocalOvPlugin,
      envVars: parentCfg.envVars,
      customLauncher: parentCfg.customLauncher,
      picture: parentCfg.picture,
    };

    // Push config into agentConfigs so startAgentOnDaemon can find it.
    // We save to disk + DB after successful start, but the in-memory array
    // needs it for the start path.
    agentConfigs.push(cloneConfig);
    saveAgentConfigs(agentConfigs);
    db.saveAgentConfig(cloneConfig);

    // Start the clone on the parent's machine. Pass resumeSession: false so
    // it gets a clean session (no conversation context carryover).
    const result = await startAgentOnDaemon(cloneId, cloneConfig, { resumeSession: false });
    if (result.error) {
      // Roll back the config we pushed
      const idx = agentConfigs.findIndex((c) => c.id === cloneId);
      if (idx >= 0) agentConfigs.splice(idx, 1);
      saveAgentConfigs(agentConfigs);
      db.deleteAgentConfig(cloneId);
      return { error: result.error, status: 400 };
    }

    // Mark the clone as active in the runtime store so that the initial prompt
    // (if any) passes deliverToAllAgents' status==="active" filter. The daemon
    // socket is already set up — the message will be queued there.
    if (store.agents[cloneId]) store.agents[cloneId].status = "active";

    // If a channel was requested at clone time, subscribe the clone there.
    // This is the only way a clone receives channel fan-out — otherwise it's
    // DM-only (the anti-double-reply policy).
    if (options.channel) {
      try {
        const { setMembership, findOrCreateChannel, parseTarget } = ctx;
        const { channelName, channelType } = parseTarget(options.channel, cloneName);
        const ch = await findOrCreateChannel(channelName, channelType, workspaceId);
        if (ch && setMembership) {
          await setMembership(ch.id, cloneId, { canRead: true, subscribed: true });
        }
      } catch (err) {
        console.warn(`[clone] Failed to subscribe clone ${cloneId} to channel ${options.channel}: ${err.message}`);
      }
    }

    // If a prompt was given, post it as a DM from the caller to the clone.
    // This wakes the clone immediately via normal delivery.
    if (options.prompt && options.callerName) {
      try {
        const { persistUserMessage, fanoutUserMessage, findOrCreateChannel, parseTarget } = ctx;
        const dmTarget = `dm:@${cloneName}`;
        const { channelName, channelType } = parseTarget(dmTarget, options.callerName);
        const ch = await findOrCreateChannel(channelName, channelType, workspaceId);
        const msg = persistUserMessage({
          workspaceId,
          channelId: ch.id,
          channelName,
          channelType,
          threadId: null,
          senderName: options.callerName,
          senderType: "human",
          content: options.prompt,
          attachments: [],
        });
        await fanoutUserMessage(msg);
      } catch (err) {
        console.warn(`[clone] Failed to post initial prompt to clone ${cloneId}: ${err.message}`);
      }
    }

    console.log(`[clone] Created clone ${cloneId} (${cloneName}) of ${parentId}`);
    return { cloneId, name: cloneName, displayName: cloneConfig.displayName };
  }

  // Clone an agent
  router.post("/api/agents/:id/clone", ctx.requireAuth, async (req, res) => {
    try {
    const { id } = req.params;
    const workspaceId = req.workspaceId || ctx.DEFAULT_WORKSPACE_ID;
    if (ctx.workspaceIdFromAgent(id) !== workspaceId) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const callerName = req.user?.name || "local-user";

    const result = await cloneAgent(id, {
      workspaceId,
      prompt: req.body?.prompt,
      channel: req.body?.channel,
      callerName,
    });
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
    } catch (err) {
      console.error("[clone] route error:", err);
      res.status(500).json({ error: err.message || "Internal error" });
    }
  });

  // Dissolve a clone: stop the process, delete the config, purge memberships.
  // Messages the clone sent remain (they're normal channel/DM history).
  // Called from the stop route when cfg.cloneOf is set.
  async function dissolveClone(agentId, workspaceId) {
    const {
      store, agentConfigs, db, agentAuth,
      daemonSockets,
      broadcastToWeb, sanitizedAgentConfigs,
      saveAgentConfigs,
      purgeAgentMemberships, purgeUnknownAgentState,
    } = ctx;

    const cfg = agentConfigs.find((c) => c.id === agentId);
    if (!cfg || !cfg.cloneOf) return false;

    // Commit any pending OV session before tearing down
    if (ctx.ovLifecycle && cfg.openvikingApiKey) {
      ctx.ovLifecycle.commitSession(agentId).catch(() => {});
    }

    // Stop the daemon process
    ctx.sendAgentStop(agentId);

    // Remove config
    const idx = agentConfigs.findIndex((c) => c.id === agentId);
    if (idx >= 0) {
      agentConfigs.splice(idx, 1);
      saveAgentConfigs(agentConfigs);
      db.deleteAgentConfig(agentId);
    }

    // Revoke token
    agentAuth.revoke(agentId);

    // Purge channel memberships
    purgeAgentMemberships(agentId);

    // Remove runtime state
    purgeUnknownAgentState(agentId);
    if (store.agents[agentId]) delete store.agents[agentId];
    daemonSockets.delete(agentId);

    // Broadcast removal
    broadcastToWeb({ type: "agent_status", workspaceId, agentId, status: "deleted" });
    broadcastToWeb({
      type: "config_updated",
      workspaceId,
      configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || ctx.DEFAULT_WORKSPACE_ID) === workspaceId),
    });

    console.log(`[clone] Dissolved clone ${agentId} of ${cfg.cloneOf}`);
    return true;
  }

  // Stop an agent
  router.post("/api/agents/:id/stop", ctx.requireAuth, async (req, res) => {
    try {
    const { id } = req.params;
    const workspaceId = req.workspaceId || ctx.DEFAULT_WORKSPACE_ID;
    if (ctx.workspaceIdFromAgent(id) !== workspaceId) return res.status(404).json({ error: "Agent not found" });

    // If this is a clone, dissolve it instead of just stopping
    const cfg = ctx.agentConfigs.find((c) => c.id === id);
    if (cfg?.cloneOf) {
      await dissolveClone(id, workspaceId);
      return res.json({ success: true, dissolved: true });
    }

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
    } catch (err) {
      console.error("[stop] route error:", err);
      res.status(500).json({ error: err.message || "Internal error" });
    }
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

    const result = await startAgentOnDaemon(id, savedConfig, { resumeSession: false });
    if (result.error) return res.status(400).json(result);
    console.log(`[api] Context reset for agent ${id}`);
    res.json({ success: true });
  });

  return { startAgentOnDaemon, autoStartAgents, cloneAgent, dissolveClone, router };
}

module.exports = { createAgentLifecycle };
