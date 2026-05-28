// HTTP Server + WebSocket: daemon connections, web connections, message handlers.
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createDaemonHandler(). No implicit closure captures.

const http = require("http");
const { WebSocketServer } = require("ws");
const { v4: uuidv4 } = require("uuid");

function createDaemonHandler(ctx) {
  const {
    app, db,
    store, agentConfigs,
    daemonConnections, daemonSockets, webSockets, machines,
    pendingRuntimeModelRequests, pendingContextResets,
    DEFAULT_WORKSPACE_ID, normalizeWorkspaceId,
    validateApiKey, findMachineKeyRecord, resolveDaemonMachineId,
    isDebugKey, computeMachineFingerprint,
    machineKeys, saveMachineKeys,
    hasKnownAgentConfig, purgeUnknownAgentState,
    evaluateAgentMachineAffinity,
    buildRuntimeAgent, syncRuntimeAgentFromConfig,
    agentPayload, sanitizedAgentConfigs,
    workspaceIdFromAgent, updateAgentWorkDir,
    broadcastToWeb,
    hydrateAgentContextUsage,
    replayPendingDeliveries,
    hasWorkspaceFsCapability,
    now,
    recordWsConnectAttempt, recordInvalidTokenAttempt, recordWsDisconnect,
    PUBLIC_URL,
  } = ctx;

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  process.on("SIGTERM", async () => {
    console.log("[server] SIGTERM received — shutting down gracefully");
    server.close(async () => {
      await db.closePool();
      process.exit(0);
    });
    // Force-exit after 10s if active connections don't drain in time
    setTimeout(() => process.exit(0), 10_000).unref();
  });

  server.on("upgrade", (request, socket, head) => {
    const parsed = new URL(request.url, `http://${request.headers.host}`);

    if (parsed.pathname === "/daemon/connect") {
      // Daemon WebSocket connection — validate API key
      const apiKey = parsed.searchParams.get("key");
      if (!validateApiKey(apiKey)) {
        console.log(`[daemon] Rejected connection: invalid API key (${apiKey?.substring(0, 12)}...) from ${request.socket.remoteAddress}:${request.socket.remotePort}`);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      // Track key usage
      const keyRecord = machineKeys.find((k) => k.rawKey === apiKey);
      if (keyRecord) {
        keyRecord.lastUsedAt = now();
        saveMachineKeys(machineKeys);
        db.saveMachineKey(keyRecord);
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleDaemonConnection(ws, apiKey);
      });
    } else if (parsed.pathname === "/ws") {
      // Web UI WebSocket connection — check optional auth token
      const wsToken = parsed.searchParams.get("token");
      const remoteIp = (request.headers["x-forwarded-for"] || "").toString().split(",")[0].trim()
        || request.socket.remoteAddress
        || null;
      // Reject upgrades that present a token the server doesn't know. Without
      // this gate, a stale tab whose session was revoked/logged-out keeps
      // hammering the server and the upgrade succeeds as a "guest" — same
      // expensive init payload, just under a different label. Outright reject
      // and escalate to a 24h block after a few strikes.
      if (wsToken && !ctx.hasAuthSession(wsToken)) {
        const entry = recordInvalidTokenAttempt(wsToken, remoteIp);
        const blocked = entry.blockedUntil > Date.now();
        const reason = (blocked ? entry.blockReason : "invalid or expired token").replace(/[\r\n]/g, " ").slice(0, 120);
        socket.write(
          `HTTP/1.1 ${blocked ? "429 Too Many Requests" : "401 Unauthorized"}\r\n` +
          "Connection: close\r\n" +
          `X-Block-Reason: ${reason}\r\n` +
          "Content-Length: 0\r\n\r\n"
        );
        socket.destroy();
        return;
      }
      const wsAuthenticated = !!wsToken; // implied: token present AND in authSessions
      // Defend the event loop: a runaway client (stale tab, buggy reconnect)
      // can saturate the single replica with init-payload work. Rate-limit by
      // token; fall back to remote IP for guests.
      const trackerToken = wsAuthenticated ? wsToken : null;
      const decision = recordWsConnectAttempt(trackerToken, remoteIp);
      if (!decision.allow) {
        const reason = decision.reason.replace(/[\r\n]/g, " ").slice(0, 120);
        socket.write(
          "HTTP/1.1 429 Too Many Requests\r\n" +
          "Connection: close\r\n" +
          `X-Block-Reason: ${reason}\r\n` +
          "Content-Length: 0\r\n\r\n"
        );
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws._trackerEntry = decision.entry;
        handleWebConnection(ws, wsAuthenticated, wsToken || null, parsed.searchParams.get("workspaceId") || DEFAULT_WORKSPACE_ID);
      });
    } else {
      socket.destroy();
    }
  });

  function handleDaemonConnection(ws, apiKey) {
    const keyAlias = findMachineKeyRecord(apiKey)?.name || '(unknown)';
    console.log(`[daemon] Connected: key=${apiKey?.substring(0, 8)}... alias=${keyAlias}`);
    let connectedAgents = new Set();
    daemonConnections.add(ws);
    ws._apiKey = apiKey;
    ws._runtimes = []; // store runtimes reported by this daemon
    ws._capabilities = [];
    const keyRecord = findMachineKeyRecord(apiKey);
    const machineId = resolveDaemonMachineId(apiKey);
    const workspaceId = keyRecord?.workspaceId || DEFAULT_WORKSPACE_ID;
    ws._machineId = machineId;
    ws._workspaceId = workspaceId;
    const existingMachine = machines.get(machineId);
    const machineRecord = {
      id: machineId,
      workspaceId,
      alias: keyRecord?.name || existingMachine?.alias,
      hostname: existingMachine?.hostname || 'unknown',
      os: existingMachine?.os || 'unknown',
      runtimes: existingMachine?.runtimes || [],
      capabilities: existingMachine?.capabilities || [],
      connectedAt: now(),
      agentIds: [],
    };
    machines.set(machineId, machineRecord);
    broadcastToWeb({ type: existingMachine ? 'machine:updated' : 'machine:connected', workspaceId, machine: machineRecord });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        handleDaemonMessage(ws, msg, connectedAgents);
      } catch (e) {
        console.error("[daemon] Invalid message:", e.message);
      }
    });

    ws.on("close", () => {
      console.log(`[daemon] Disconnected: machine=${ws._machineId}`);
      daemonConnections.delete(ws);
      const replacementConnected = Array.from(daemonConnections).some((otherWs) => (
        otherWs.readyState === 1 && otherWs._machineId === ws._machineId
      ));
      if (!replacementConnected) {
        machines.delete(ws._machineId);
        broadcastToWeb({ type: 'machine:disconnected', workspaceId: ws._workspaceId || DEFAULT_WORKSPACE_ID, machineId: ws._machineId });
      }
      for (const agentId of connectedAgents) {
        if (daemonSockets.get(agentId) !== ws) continue;
        if (store.agents[agentId]) {
          const agentWorkspaceId = normalizeInactiveAgentState(agentId, "inactive");
          clearAgentRuntimeBinding(agentId, ws);
          broadcastAgentStatus(agentId, "inactive", agentWorkspaceId);
        }
      }
      // Daemon swap on the same machine: another daemon authenticated with the
      // same api key is still online, so reuse the existing autoStart path to
      // re-bind orphaned agents. autoStartAgents respects per-config autoStart
      // and startAgentOnDaemon enforces machineId match, so this can only
      // re-target the surviving same-machine daemon.
      if (replacementConnected) {
        setTimeout(() => ctx.autoStartAgents(), 500);
      }
    });

    // Application-level keepalive. Cellular NAT gateways drop idle TCP mappings
    // in as little as 30 s, and Cloudflare's WebSocket idle timeout is 100 s.
    // Without a regular frame the connection goes stale — the client's inbound
    // watchdog (web/src/lib/ws.ts, INBOUND_WATCHDOG_MS) relies on these pings to
    // know the socket is still alive. Interval must be < watchdog / 2.
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
    ws.on("close", () => clearInterval(pingInterval));
  }

  // Per-agent serialization for save-then-broadcast of activity frames.
  // Ensures: (1) the DB write commits before the live WS broadcast, so a client
  // that fetches history via HTTP after receiving the WS event will see that
  // entry in the fetch result; (2) frames from the same agent broadcast in
  // arrival order even when awaits vary.
  const activityChains = new Map();
  function enqueueActivity(agentId, task) {
    const prev = activityChains.get(agentId) || Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    activityChains.set(agentId, next);
    next.finally(() => {
      if (activityChains.get(agentId) === next) activityChains.delete(agentId);
    });
  }

  function isBusyActivity(activity) {
    return activity === "working" || activity === "thinking" || activity === "error";
  }

  function clearAgentRuntimeBinding(agentId, ws = null) {
    if (!ws || daemonSockets.get(agentId) === ws) {
      daemonSockets.delete(agentId);
    }
    for (const machine of machines.values()) {
      if (Array.isArray(machine.agentIds)) {
        machine.agentIds = machine.agentIds.filter((id) => id !== agentId);
      }
    }
  }

  function normalizeInactiveAgentState(agentId, status = "inactive") {
    const agent = store.agents[agentId];
    if (!agent) return null;
    agent.status = status;
    agent.activity = "offline";
    agent.activityDetail = undefined;
    return workspaceIdFromAgent(agentId);
  }

  function broadcastAgentStatus(agentId, status, workspaceId = null) {
    const scopedWorkspaceId = workspaceId || workspaceIdFromAgent(agentId);
    broadcastToWeb({ type: "agent_status", workspaceId: scopedWorkspaceId, agentId, status });
    if (status !== "active") {
      broadcastToWeb({
        type: "agent_activity",
        workspaceId: scopedWorkspaceId,
        agentId,
        activity: "offline",
      });
    }
  }

  function reconcileAgentLifecycleHealth(ws, msg) {
    const { agentId, reason } = msg || {};
    if (!agentId || !reason) return;
    const agent = store.agents[agentId];
    if (!agent) return;
    const ownerWs = daemonSockets.get(agentId);
    if (ownerWs && ownerWs !== ws) {
      console.warn(`[agent:${agentId}] Ignoring lifecycle health reason=${reason} from stale connection machine=${ws._machineId}`);
      return;
    }
    if (agent.status !== "active") return;

    if (reason === "agent_idle" && agent.activity !== "online") {
      const prev = agent.activity || "?";
      agent.activity = "online";
      agent.activityDetail = "Idle";
      console.log(`[agent:${agentId}] Lifecycle health reconciled activity: ${prev} -> online`);
      broadcastToWeb({
        type: "agent_activity",
        workspaceId: workspaceIdFromAgent(agentId),
        agentId,
        activity: "online",
        detail: "Idle",
      });
    }
  }

  function sendAgentStop(
    agentId,
    preferredWs = null,
    {
      broadcast = preferredWs == null,
      includeCurrentOwner = preferredWs == null,
    } = {}
  ) {
    const targets = new Set();
    if (preferredWs?.readyState === 1) targets.add(preferredWs);
    if (includeCurrentOwner) {
      const directWs = daemonSockets.get(agentId);
      if (directWs?.readyState === 1) targets.add(directWs);
    }
    if (broadcast) {
      for (const ws of daemonConnections) {
        if (ws.readyState === 1) targets.add(ws);
      }
    }
    for (const ws of targets) {
      ws.send(JSON.stringify({ type: "agent:stop", agentId }));
    }
  }

  function handleDaemonMessage(ws, msg, connectedAgents) {
    switch (msg.type) {
      case "daemon:health": {
        reconcileAgentLifecycleHealth(ws, msg);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "daemon:health:ack",
            seq: msg.seq,
            reason: msg.reason,
            agentId: msg.agentId,
            launchId: msg.launchId,
            sentAt: msg.sentAt,
            serverAt: new Date().toISOString(),
            machineId: ws._machineId,
          }));
        }
        break;
      }
      case "ready": {
        console.log(`[daemon] Ready: machine=${ws._machineId} runtimes=${msg.runtimes?.join(",")} agents=${msg.runningAgents?.join(",") || "none"}`);
        ws._runtimes = msg.runtimes || [];
        ws._capabilities = msg.capabilities || [];
        // Update machine record with real info from daemon
        const machine = machines.get(ws._machineId);
        if (machine) {
          const keyRecord = findMachineKeyRecord(ws._apiKey);
          if (keyRecord?.name) machine.alias = keyRecord.name;
          machine.hostname = msg.hostname || 'unknown';
          machine.os = msg.os || 'unknown';
          machine.runtimes = msg.runtimes || [];
          machine.capabilities = msg.capabilities || [];
          broadcastToWeb({ type: 'machine:updated', machine });
        }
        // Machine binding: silently bind or reject based on hostname:os fingerprint
        if (!isDebugKey(ws._apiKey)) {
          const keyRecord = findMachineKeyRecord(ws._apiKey);
          if (keyRecord) {
            const fingerprint = computeMachineFingerprint(msg.hostname, msg.os);
            if (!keyRecord.boundFingerprint) {
              // First-time bind: record the fingerprint
              keyRecord.boundFingerprint = fingerprint;
              saveMachineKeys(machineKeys);
              db.saveMachineKey(keyRecord);
              console.log(`[daemon] Key "${keyRecord.name}" bound to machine fingerprint ${fingerprint.substring(0, 12)}...`);
            } else if (keyRecord.boundFingerprint !== fingerprint) {
              // Fingerprint mismatch: reject silently
              console.log(`[daemon] Key "${keyRecord.name}" rejected — fingerprint mismatch (expected ${keyRecord.boundFingerprint.substring(0, 12)}..., got ${fingerprint.substring(0, 12)}...)`);
              ws.close(1008, 'machine binding mismatch');
              return;
            }
          }
        }
        // Auto-start configured agents after a short delay
        setTimeout(() => ctx.autoStartAgents(), 1000);
        // Register any running agents
        if (msg.runningAgents) {
          for (const agentId of msg.runningAgents) {
            if (!hasKnownAgentConfig(agentId)) {
              purgeUnknownAgentState(agentId);
              sendAgentStop(agentId, ws, { broadcast: false });
              continue;
            }
            const affinity = evaluateAgentMachineAffinity(agentId, ws);
            if (!affinity.allowed) {
              console.log(`[agent:${agentId}] Rejecting daemon adoption from machine ${ws._machineId}; expected ${affinity.expectedMachineId}`);
              sendAgentStop(agentId, ws, { broadcast: false });
              continue;
            }
            connectedAgents.add(agentId);
            daemonSockets.set(agentId, ws);
            const isNew = !store.agents[agentId];
            if (isNew) {
              store.agents[agentId] = buildRuntimeAgent(agentId, { status: "active", machineId: ws._machineId });
            } else {
              // Refresh config fields on existing agents — they may still
              // have stale/fallback values from before configs were loaded.
              const cfg = agentConfigs.find((c) => c.id === agentId);
              if (cfg) syncRuntimeAgentFromConfig(agentId, cfg);
            }
            store.agents[agentId].status = "active";
            store.agents[agentId].machineId = ws._machineId;
            // Track agent in machine record (mirrors "agent:status" handler)
            const readyMachine = machines.get(ws._machineId);
            if (readyMachine && !readyMachine.agentIds.includes(agentId)) {
              readyMachine.agentIds.push(agentId);
            }
            broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
            hydrateAgentContextUsage(agentId);
            replayPendingDeliveries(agentId);
          }
        }
        // Reconcile stale agent state: any agent on this machine that is not
        // in runningAgents but still shows working/thinking/error activity had its
        // process die (or its turn_end event was dropped during a reconnect race)
        // without the server receiving the final activity update. Active agents
        // are reset to online/idle; inactive or stopping agents stay offline so
        // lifecycle state and activity never contradict each other.
        // Running agents are skipped here; the daemon re-broadcasts their current
        // activity via agent:activity messages that follow immediately after 'ready'.
        {
          const runningSet = new Set(msg.runningAgents || []);
          for (const [agentId, agent] of Object.entries(store.agents)) {
            if (agent.machineId !== ws._machineId) continue;
            if (runningSet.has(agentId)) continue;
            if (isBusyActivity(agent.activity)) {
              const activity = agent.status === "active" ? "online" : "offline";
              store.agents[agentId].activity = activity;
              store.agents[agentId].activityDetail = undefined;
              broadcastToWeb({
                type: "agent_activity",
                workspaceId: workspaceIdFromAgent(agentId),
                agentId,
                activity,
                detail: activity === "online" ? "Idle" : undefined,
              });
            }
          }
        }
        break;
      }
      case "agent:status": {
        const { agentId, status } = msg;
        if (!hasKnownAgentConfig(agentId)) {
          purgeUnknownAgentState(agentId);
          sendAgentStop(agentId, ws, { broadcast: false });
          break;
        }
        const affinity = evaluateAgentMachineAffinity(agentId, ws);
        if (!affinity.allowed) {
          console.log(`[agent:${agentId}] Ignoring status from machine ${ws._machineId}; expected ${affinity.expectedMachineId}`);
          sendAgentStop(agentId, ws, { broadcast: false });
          break;
        }
        const isNew = !store.agents[agentId];
        const wasActive = !isNew && store.agents[agentId].status === "active";
        if (isNew) {
          store.agents[agentId] = buildRuntimeAgent(agentId, {
            status,
            machineId: ws._machineId,
          });
        } else {
          const cfg = agentConfigs.find((c) => c.id === agentId);
          if (cfg) syncRuntimeAgentFromConfig(agentId, cfg);
        }
        store.agents[agentId].status = status;
        store.agents[agentId].machineId = ws._machineId;
        const workDirChanged = updateAgentWorkDir(agentId, msg.workDir);
        const agentWorkspaceId = status === "active"
          ? workspaceIdFromAgent(agentId)
          : normalizeInactiveAgentState(agentId, status);
        if (status === "active") {
          connectedAgents.add(agentId);
          daemonSockets.set(agentId, ws);
          // Track agent in machine record
          const machine = machines.get(ws._machineId);
          if (machine && !machine.agentIds.includes(agentId)) {
            machine.agentIds.push(agentId);
          }
        } else {
          connectedAgents.delete(agentId);
          clearAgentRuntimeBinding(agentId, ws);
        }
        if (isNew) {
          broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
        } else {
          broadcastAgentStatus(agentId, status, agentWorkspaceId);
          if (workDirChanged) {
            broadcastToWeb({ type: "agent_started", agent: agentPayload(agentId) });
            const wsId = workspaceIdFromAgent(agentId);
            broadcastToWeb({
              type: "config_updated",
              workspaceId: wsId,
              configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === wsId),
            });
          }
        }
        if (status === "active") hydrateAgentContextUsage(agentId);
        if (status === "active") {
          replayPendingDeliveries(agentId);
          if (!wasActive) {
            db.trimAgentActivities(agentId).catch((e) =>
              console.error(`[db] trimAgentActivities(${agentId}) failed:`, e.message)
            );
          }
        }
        if (status === "inactive") {
          const resolver = pendingContextResets.get(agentId);
          if (resolver) {
            pendingContextResets.delete(agentId);
            resolver();
          }
          // OV managed auto-commit on agent stop (skip for plugin agents)
          const agentCfg = agentConfigs.find((c) => c.id === agentId);
          if (agentCfg?.openvikingApiKey && !ctx.isOvPluginForAgent(agentCfg)) {
            ctx.ovLifecycle.commitSession(agentId).catch(() => {});
          }
        }
        console.log(`[agent:${agentId}] Status: ${status} machine=${ws._machineId}`);
        break;
      }
      case "agent:activity": {
        const { agentId, activity, detail, entries, contextUsage } = msg;
        if (!hasKnownAgentConfig(agentId)) {
          purgeUnknownAgentState(agentId);
          sendAgentStop(agentId, ws, { broadcast: false });
          break;
        }
        const ownerWs = daemonSockets.get(agentId);
        if (ownerWs && ownerWs !== ws) {
          console.warn(`[agent:${agentId}] Dropped activity=${activity} from stale connection machine=${ws._machineId} (owner=machine:${ownerWs._machineId})`);
          break;
        }
        enqueueActivity(agentId, async () => {
          const current = store.agents[agentId];
          if (current?.status !== "active" && activity !== "offline") {
            console.warn(`[agent:${agentId}] Dropped activity=${activity} while status=${current?.status || "unknown"}`);
            if (Array.isArray(entries) && entries.length > 0) {
              try {
                await db.saveActivityEntries(agentId, activity, detail, entries);
              } catch (e) {
                console.error(`[db] saveActivityEntries(${agentId}) failed:`, e.message);
              }
            }
            return;
          }
          const prev = store.agents[agentId]?.activity;
          if (store.agents[agentId]) {
            store.agents[agentId].activity = activity;
            store.agents[agentId].activityDetail = detail;
            if (contextUsage) {
              store.agents[agentId].contextUsage = contextUsage;
            }
          }
          if (prev !== activity) {
            console.log(`[agent:${agentId}] Activity: ${prev ?? '?'} → ${activity}${detail ? ` (${detail})` : ''}`);
          }
          if (Array.isArray(entries) && entries.length > 0) {
            try {
              await db.saveActivityEntries(agentId, activity, detail, entries);
            } catch (e) {
              console.error(`[db] saveActivityEntries(${agentId}) failed:`, e.message);
            }
          }
          const visibleEntries = Array.isArray(entries)
            ? entries.filter((e) => e.content || e.text || e.detail || e.title || e.toolName
              || (e.kind === 'context_usage' && e.contextUsage)
              || (e.kind === 'status' && e.activity && e.activity !== 'online' && e.activity !== 'idle'))
            : entries;
          broadcastToWeb({
            type: "agent_activity",
            workspaceId: workspaceIdFromAgent(agentId),
            agentId,
            activity,
            detail,
            entries: visibleEntries,
            contextUsage,
          });
        });
        break;
      }
      case "agent:session": {
        const { agentId, sessionId } = msg;
        if (!hasKnownAgentConfig(agentId)) {
          purgeUnknownAgentState(agentId);
          sendAgentStop(agentId, ws, { broadcast: false });
          break;
        }
        const ownerWs = daemonSockets.get(agentId);
        if (ownerWs && ownerWs !== ws) {
          console.log(`[agent:${agentId}] Ignoring session update from stale daemon connection on machine ${ws._machineId}`);
          break;
        }
        if (store.agents[agentId]) {
          store.agents[agentId].sessionId = sessionId;
        }
        break;
      }
      case "agent:deliver:ack": {
        // Acknowledged delivery, no-op
        break;
      }
      case "agent:workspace:file_tree": {
        const ownerWs = daemonSockets.get(msg.agentId);
        if (ownerWs && ownerWs !== ws) {
          console.log(`[agent:${msg.agentId}] Ignoring workspace tree from stale daemon connection on machine ${ws._machineId}`);
          break;
        }
        const workDirChanged = updateAgentWorkDir(msg.agentId, msg.workDir);
        const wsId = workspaceIdFromAgent(msg.agentId);
        // Forward to web UI
        broadcastToWeb({
          type: "workspace:file_tree",
          workspaceId: wsId,
          agentId: msg.agentId,
          dirPath: msg.dirPath || "",
          workDir: msg.workDir,
          files: msg.files,
        });
        if (workDirChanged) {
          broadcastToWeb({ type: "agent_started", agent: agentPayload(msg.agentId) });
          broadcastToWeb({
            type: "config_updated",
            workspaceId: wsId,
            configs: sanitizedAgentConfigs().filter((c) => (c.workspaceId || DEFAULT_WORKSPACE_ID) === wsId),
          });
        }
        break;
      }
      case "agent:workspace:file_content": {
        const ownerWs = daemonSockets.get(msg.agentId);
        if (ownerWs && ownerWs !== ws) {
          console.log(`[agent:${msg.agentId}] Ignoring workspace file content from stale daemon connection on machine ${ws._machineId}`);
          break;
        }
        broadcastToWeb({ type: "workspace:file_content", workspaceId: workspaceIdFromAgent(msg.agentId), agentId: msg.agentId, requestId: msg.requestId, content: msg.content });
        break;
      }
      case "agent:memory:list_result": {
        broadcastToWeb({ type: "memory:list_result", workspaceId: workspaceIdFromAgent(msg.agentId), agentId: msg.agentId, uri: msg.uri, entries: msg.entries, error: msg.error });
        break;
      }
      case "agent:memory:content": {
        broadcastToWeb({ type: "memory:content", workspaceId: workspaceIdFromAgent(msg.agentId), agentId: msg.agentId, requestId: msg.requestId, uri: msg.uri, level: msg.level || null, content: msg.content, error: msg.error });
        break;
      }
      case "agent:skills:list_result": {
        const ownerWs = daemonSockets.get(msg.agentId);
        if (ownerWs && ownerWs !== ws) {
          console.log(`[agent:${msg.agentId}] Ignoring skills result from stale daemon connection on machine ${ws._machineId}`);
          break;
        }
        broadcastToWeb({ type: "skills:list_result", workspaceId: workspaceIdFromAgent(msg.agentId), agentId: msg.agentId, global: msg.global, workspace: msg.workspace });
        break;
      }
      case "machine:workspace:scan_result": {
        broadcastToWeb({ type: "machine:workspace:scan_result", workspaceId: ws._workspaceId || DEFAULT_WORKSPACE_ID, machineId: ws._machineId, directories: msg.directories });
        break;
      }
      case "machine:workspace:delete_result": {
        broadcastToWeb({ type: "machine:workspace:delete_result", workspaceId: ws._workspaceId || DEFAULT_WORKSPACE_ID, machineId: ws._machineId, directoryName: msg.directoryName, success: msg.success });
        break;
      }
      case "machine:runtime_models:result": {
        const pending = pendingRuntimeModelRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRuntimeModelRequests.delete(msg.requestId);
          pending.resolve({
            models: Array.isArray(msg.models) ? msg.models : [],
            default: typeof msg.default === "string" ? msg.default : null,
            error: typeof msg.error === "string" ? msg.error : null,
          });
        }
        break;
      }
      case "pong": {
        // Heartbeat response, no-op
        break;
      }
      default: {
        console.log(`[daemon] Unknown message type: ${msg.type}`);
      }
    }
  }

  // WS message types that require authentication (write operations)
  const WS_AUTH_REQUIRED_TYPES = new Set([
    "agent:start",
    "agent:stop",
    "machine:workspace:delete",
    "machine:workspace:scan",
  ]);

  function handleWebConnection(ws, authenticated, token = null, workspaceId = DEFAULT_WORKSPACE_ID) {
    ws._authenticated = !!authenticated;
    ws._authToken = token;
    ws._workspaceId = normalizeWorkspaceId(workspaceId);
    const user = token ? ctx.getAuthSession(token) : null;
    if (user && !ctx.isEmbedSessionUser(user) && ws._workspaceId === DEFAULT_WORKSPACE_ID && ctx.findWorkspace(ws._workspaceId) && ctx.isEmailAllowed(user.email, ws._workspaceId)) {
      ctx.ensureWorkspaceMemberForUser(user, ws._workspaceId);
    }
    if ((!user && ws._workspaceId !== DEFAULT_WORKSPACE_ID) || (user && !ctx.userCanAccessWorkspace(user, ws._workspaceId)) || !ctx.findWorkspace(ws._workspaceId)) {
      ws._workspaceId = DEFAULT_WORKSPACE_ID;
    }
    // Seed from the auth session so DM broadcasts can be filtered immediately;
    // setWebPresence() will overwrite this with the canonical presence identity.
    ws._humanName = user?.name || null;
    ws._human = null;
    webSockets.add(ws);

    // Defer the init send so a burst of reconnects doesn't monopolize one tick.
    // The init payload is large (channels + agents + humans + configs + machines
    // + presets) and JSON.stringify is sync; spreading sends across ticks lets
    // unrelated HTTP requests interleave instead of queuing behind a burst.
    setImmediate(() => {
      if (ws.readyState !== 1) return;
      const canReadWorkspace = user
        ? ctx.userCanAccessWorkspace(user, ws._workspaceId)
        : ws._workspaceId === DEFAULT_WORKSPACE_ID && !ctx.allowlistActive(ws._workspaceId);
      const embedUser = ctx.isEmbedSessionUser(user);
      const embedAgentIds = embedUser ? ctx.embedVisibleAgentIds(user) : null;
      ws._embedAgentIds = embedAgentIds;
      const visibleChannels = canReadWorkspace ? store.channels.filter((ch) => (
        (ch.workspaceId || DEFAULT_WORKSPACE_ID) === ws._workspaceId
        && (ch.type || "channel") === "channel"
        && (!embedUser || ctx.embedCanAccessChannel(user, ch, ws._workspaceId))
      )) : [];
      const visibleAgents = canReadWorkspace ? Object.keys(store.agents)
        .map((id) => agentPayload(id))
        .filter((agent) => (
          (agent?.workspaceId || DEFAULT_WORKSPACE_ID) === ws._workspaceId
          && (!embedAgentIds || embedAgentIds.has(agent.id))
        )) : [];
      try {
        ws.send(JSON.stringify({
          type: "init",
          workspaceId: ws._workspaceId,
          workspaces: ctx.visibleWorkspacesForUser(user),
          workspaceMembers: canReadWorkspace && !embedUser ? ctx.listWorkspaceMembers(ws._workspaceId) : [],
          workspaceAllowlistActive: ctx.allowlistActive(ws._workspaceId),
          viewerRole: user ? ctx.userWorkspaceRole(user, ws._workspaceId) : null,
          isSuperuser: !!(user && ctx.isSuperuser(user.email)),
          channels: visibleChannels,
          agents: visibleAgents,
          humans: embedUser ? [] : ctx.currentHumans(),
          configs: canReadWorkspace && !embedUser ? sanitizedAgentConfigs().filter((config) => (config.workspaceId || DEFAULT_WORKSPACE_ID) === ws._workspaceId) : [],
          machines: canReadWorkspace && !embedUser ? Array.from(machines.values()).filter((machine) => (machine.workspaceId || DEFAULT_WORKSPACE_ID) === ws._workspaceId) : [],
        }));
      } catch (e) {
        console.warn("[web] init send failed:", e.message);
      }
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        handleWebMessage(ws, msg);
      } catch (e) {
        console.error("[web] Invalid message:", e.message);
      }
    });

    ws.on("close", () => {
      if (ws._humanName) ctx.removeHumanPresence(ws._humanName);
      webSockets.delete(ws);
      recordWsDisconnect(ws._trackerEntry);
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
    ws.on("close", () => clearInterval(pingInterval));
  }

  function sendWebError(ws, message, extra = {}) {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "error", message, ...extra }));
  }

  function webRequestWorkspaceId(ws, msg) {
    const socketWorkspaceId = normalizeWorkspaceId(ws._workspaceId || DEFAULT_WORKSPACE_ID);
    const requestedWorkspaceId = normalizeWorkspaceId(msg.workspaceId || socketWorkspaceId);
    if (requestedWorkspaceId !== socketWorkspaceId) {
      sendWebError(ws, "Workspace mismatch. Reconnect the socket for the selected workspace.", {
        code: "workspace_mismatch",
        workspaceId: socketWorkspaceId,
        requestedWorkspaceId,
      });
      return null;
    }
    const user = ws._authToken ? ctx.getAuthSession(ws._authToken) : null;
    const defaultOpenRead = !user && requestedWorkspaceId === DEFAULT_WORKSPACE_ID && !ctx.allowlistActive(requestedWorkspaceId);
    if (!ctx.findWorkspace(requestedWorkspaceId) || (!defaultOpenRead && (!user || !ctx.userCanAccessWorkspace(user, requestedWorkspaceId)))) {
      sendWebError(ws, "Not a member of this workspace.", {
        code: "workspace_forbidden",
        workspaceId: requestedWorkspaceId,
      });
      return null;
    }
    return requestedWorkspaceId;
  }

  function webAgentRequest(ws, msg) {
    const workspaceId = webRequestWorkspaceId(ws, msg);
    if (!workspaceId) return null;
    const agentId = typeof msg.agentId === "string" ? msg.agentId : "";
    if (!agentId || workspaceIdFromAgent(agentId) !== workspaceId) {
      sendWebError(ws, "Agent not found in this workspace.", {
        code: "agent_not_found",
        workspaceId,
        agentId,
      });
      return null;
    }
    return { workspaceId, agentId, agentWs: daemonSockets.get(agentId) };
  }

  function handleWebMessage(ws, msg) {
    // Block write-type messages from unauthenticated (guest) connections
    if (WS_AUTH_REQUIRED_TYPES.has(msg.type) && !ws._authenticated) {
      ws.send(JSON.stringify({ type: "error", message: "Authentication required. Please sign in to perform this action." }));
      console.log(`[web] Blocked unauthenticated WS message: ${msg.type}`);
      return;
    }
    const user = ws._authToken ? ctx.getAuthSession(ws._authToken) : null;
    if (ctx.isEmbedSessionUser(user) && msg.type !== "presence:update" && msg.type !== "presence:clear") {
      sendWebError(ws, "Embed sessions can only use chat presence over websocket.", { code: "embed_forbidden" });
      return;
    }

    switch (msg.type) {
      case "presence:update": {
        ctx.setWebPresence(ws, msg);
        break;
      }
      case "presence:clear": {
        ctx.setWebPresence(ws, {});
        break;
      }
      case "workspace:list": {
        const request = webAgentRequest(ws, msg);
        if (!request) break;
        const agentWs = request.agentWs;
        if (agentWs && agentWs.readyState === 1) {
          const payload = { agentId: request.agentId, dirPath: msg.dirPath || "" };
          if (hasWorkspaceFsCapability(agentWs)) {
            agentWs.send(JSON.stringify({ type: "workspace:list", ...payload }));
          } else {
            agentWs.send(JSON.stringify({ type: "agent:workspace:list", ...payload }));
          }
        }
        break;
      }
      case "workspace:read": {
        const request = webAgentRequest(ws, msg);
        if (!request) break;
        const agentWs = request.agentWs;
        if (agentWs && agentWs.readyState === 1) {
          const payload = { agentId: request.agentId, requestId: msg.requestId || uuidv4(), path: msg.path };
          if (hasWorkspaceFsCapability(agentWs)) {
            agentWs.send(JSON.stringify({ type: "workspace:read", ...payload }));
          } else {
            agentWs.send(JSON.stringify({ type: "agent:workspace:read", ...payload }));
          }
        }
        break;
      }
      case "memory:list": {
        const request = webAgentRequest(ws, msg);
        if (!request) break;
        const ovCreds = ctx.resolveOvCredentials(request.agentId);
        if (ovCreds && !ctx.isLocalUrl(ovCreds.url)) {
          const uri = msg.uri || "viking://";
          ctx.ovHttpList(ovCreds, uri)
            .then((data) => {
              const raw = Array.isArray(data?.result) ? data.result : [];
              const entries = raw.map((e) => ({
                uri: e.uri,
                isDir: !!e.isDir,
                abstract: e.abstract,
              }));
              console.log(`[memory:list] ${request.agentId} uri=${uri} → ${entries.length} entries`);
              broadcastToWeb({ type: "memory:list_result", workspaceId: request.workspaceId, agentId: request.agentId, uri, entries });
            })
            .catch((e) => {
              console.warn(`[memory:list] ${request.agentId} uri=${uri} failed: ${e.message}`);
              broadcastToWeb({ type: "memory:list_result", workspaceId: request.workspaceId, agentId: request.agentId, uri, entries: [], error: e.message });
            });
        } else {
          const agentWs = request.agentWs;
          if (agentWs && agentWs.readyState === 1) {
            agentWs.send(JSON.stringify({ type: "agent:memory:list", agentId: request.agentId, uri: msg.uri || "viking://" }));
          }
        }
        break;
      }
      case "memory:read": {
        const request = webAgentRequest(ws, msg);
        if (!request) break;
        const ovCreds = ctx.resolveOvCredentials(request.agentId);
        const level = msg.level === "l0" || msg.level === "l1" || msg.level === "l2" ? msg.level : null;
        if (ovCreds && !ctx.isLocalUrl(ovCreds.url)) {
          let uri = msg.uri;
          // L0/L1 are directory-level products; OV expects a trailing slash for dir URIs.
          // (Mirrors atlas-fs openviking-adapter.read behavior.)
          if ((level === "l0" || level === "l1") && uri && uri !== "viking://" && !uri.endsWith("/")) {
            uri = uri + "/";
          }
          const requestId = msg.requestId || uuidv4();
          ctx.ovHttpReadContent(ovCreds, uri, level || "l2")
            .then((content) => {
              broadcastToWeb({ type: "memory:content", workspaceId: request.workspaceId, agentId: request.agentId, requestId, uri: msg.uri, level, content, error: null });
            })
            .catch((e) => {
              broadcastToWeb({ type: "memory:content", workspaceId: request.workspaceId, agentId: request.agentId, requestId, uri: msg.uri, level, content: null, error: e.message });
            });
        } else {
          const agentWs = request.agentWs;
          if (agentWs && agentWs.readyState === 1) {
            agentWs.send(JSON.stringify({ type: "agent:memory:read", agentId: request.agentId, requestId: msg.requestId || uuidv4(), uri: msg.uri, level }));
          }
        }
        break;
      }
      case "agent:start": {
        // Trigger agent start via daemon — saved config's machineId is
        // authoritative. The payload can only pick a machine when no config
        // exists yet (first-bind for a brand-new agent).
        const savedCfg = msg.agentId ? agentConfigs.find((c) => c.id === msg.agentId) : null;
        const requestedMachineId = savedCfg?.machineId
          || (typeof msg.machineId === "string" && msg.machineId.trim()
            ? msg.machineId.trim()
            : (typeof msg.config?.machineId === "string" && msg.config.machineId.trim()
              ? msg.config.machineId.trim()
              : null));
        if (savedCfg && !savedCfg.machineId) {
          console.log(`[ws] Refusing agent:start for ${msg.agentId}: saved config has no machineId`);
          break;
        }
        let targetWs = null;
        const existing = msg.agentId ? daemonSockets.get(msg.agentId) : null;
        if (existing && existing.readyState === 1 && (!requestedMachineId || existing._machineId === requestedMachineId)) {
          targetWs = existing;
        }
        if (!targetWs) {
          for (const dws of daemonConnections) {
            if (dws.readyState !== 1) continue;
            if (requestedMachineId && dws._machineId !== requestedMachineId) continue;
            targetWs = dws;
            break;
          }
        }
        if (savedCfg && targetWs && targetWs._machineId !== savedCfg.machineId) {
          console.log(`[ws] Refusing agent:start for ${msg.agentId}: daemon ${targetWs._machineId} != bound ${savedCfg.machineId}`);
          break;
        }
        if (targetWs && targetWs.readyState === 1) {
          const agentId = msg.agentId || `agent-${uuidv4().substring(0, 8)}`;
          daemonSockets.set(agentId, targetWs);
          const config = {
            runtime: msg.config?.runtime || "claude",
            model: msg.config?.model || "sonnet",
            serverUrl: PUBLIC_URL,
            authToken: "test",
            name: agentId,
            displayName: agentId,
            ...msg.config,
          };
          targetWs.send(JSON.stringify({
            type: "agent:start",
            agentId,
            launchId: uuidv4(),
            config,
          }));
        }
        break;
      }
      case "agent:stop": {
        const agentWs = daemonSockets.get(msg.agentId);
        if (agentWs && agentWs.readyState === 1) {
          agentWs.send(JSON.stringify({ type: "agent:stop", agentId: msg.agentId }));
        }
        break;
      }
      case "skills:list": {
        const request = webAgentRequest(ws, msg);
        if (!request) break;
        const agentWs = request.agentWs;
        if (agentWs && agentWs.readyState === 1) {
          agentWs.send(JSON.stringify({ type: "agent:skills:list", agentId: request.agentId, runtime: msg.runtime || null }));
        }
        break;
      }
      case "machine:workspace:scan": {
        const workspaceId = webRequestWorkspaceId(ws, msg);
        if (!workspaceId) break;
        // Target a specific machine by machineId, or broadcast to all daemons
        let sent = false;
        for (const dws of daemonConnections) {
          if (
            dws.readyState === 1
            && normalizeWorkspaceId(dws._workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
            && (!msg.machineId || dws._machineId === msg.machineId)
          ) {
            dws.send(JSON.stringify({ type: "machine:workspace:scan" }));
            sent = true;
            if (msg.machineId) break;
          }
        }
        break;
      }
      case "machine:workspace:delete": {
        const workspaceId = webRequestWorkspaceId(ws, msg);
        if (!workspaceId) break;
        for (const dws of daemonConnections) {
          if (
            dws.readyState === 1
            && normalizeWorkspaceId(dws._workspaceId || DEFAULT_WORKSPACE_ID) === workspaceId
            && (!msg.machineId || dws._machineId === msg.machineId)
          ) {
            dws.send(JSON.stringify({ type: "machine:workspace:delete", directoryName: msg.directoryName }));
            if (msg.machineId) break;
          }
        }
        break;
      }
    }
  }

  return {
    server, wss,
    handleDaemonConnection, handleWebConnection,
    // Expose helpers that index.js references directly
    normalizeInactiveAgentState, broadcastAgentStatus,
    clearAgentRuntimeBinding, sendAgentStop,
  };
}

module.exports = { createDaemonHandler };
