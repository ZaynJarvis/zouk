// OpenViking memory proxy routes.
//
// Extracted from index.js. All external dependencies are accessed via the `ctx`
// object passed to createOvMemoryRouter(). No implicit closure captures.

const { Router } = require("express");
const ovApi = require("../ov-api");

function createOvMemoryRouter(ctx) {
  const router = Router();

  const {
    requireWorkspaceRead,
    agentConfigs, store,
    DEFAULT_WORKSPACE_ID,
    workspaceIdFromAgent,
    isOvEnabledForAgent,
    resolveAgentOvCreds,
  } = ctx;

  // ─── Helpers ──────────────────────────────────────────────────────

  // Adapter over the shared mode-aware resolver. ov-memory's routes historically
  // returned `user` (not `userId`) and exposed an `agentId` field — keep that
  // shape for daemon-handler consumers that still read it.
  function resolveOvCredentials(agentId) {
    const cfg = agentConfigs.find((c) => c.id === agentId);
    if (!cfg) return null;
    const resolved = resolveAgentOvCreds(cfg);
    if (!resolved) return null;
    return {
      url: resolved.url,
      apiKey: resolved.apiKey,
      user: resolved.userId,
      account: resolved.account,
      agentId: cfg.name || agentId,
    };
  }

  function isLocalUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      const host = u.hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local");
    } catch { return false; }
  }

  // ov-api expects a `user` field; resolveOvCredentials already emits that
  // shape — these thin wrappers exist so existing consumers
  // (daemon-handler) keep their familiar names without each one needing to
  // know the new module.
  async function ovHttpList(creds, uri, recursive = false) {
    const entries = await ovApi.lsDir(creds, uri, { recursive });
    return { status: "ok", result: entries };
  }

  async function ovHttpReadContent(creds, uri, level) {
    return ovApi.readContent(creds, uri, level);
  }

  function parseOvListResult(text, parentUri) {
    let base = "";
    if (parentUri) {
      const i = parentUri.indexOf("://");
      const scheme = i >= 0 ? parentUri.slice(0, i + 3) : "";
      const path = i >= 0 ? parentUri.slice(i + 3).replace(/\/+$/, "") : parentUri.replace(/\/+$/, "");
      base = scheme + (path ? path + "/" : "");
    }
    return text.split("\n").filter(Boolean).map((line) => {
      const dirMatch = line.match(/^\[dir\]\s+(.+)/);
      const fileMatch = line.match(/^\[file\]\s+(.+)/);
      if (dirMatch) {
        const name = dirMatch[1].trim();
        return { uri: name.startsWith("viking://") ? name : base + name, isDir: true };
      }
      if (fileMatch) {
        const name = fileMatch[1].trim();
        return { uri: name.startsWith("viking://") ? name : base + name, isDir: false };
      }
      return null;
    }).filter(Boolean);
  }

  function lookupAgentCfgForOv(agentId) {
    return agentConfigs.find((c) => c.id === agentId) || store.agents[agentId] || null;
  }

  // ─── Routes ───────────────────────────────────────────────────────

  router.get("/agents/:id/ov/status", requireWorkspaceRead, (req, res) => {
    if (workspaceIdFromAgent(req.params.id) !== (req.workspaceId || DEFAULT_WORKSPACE_ID)) {
      return res.status(404).json({ error: "unknown agent" });
    }
    const cfg = lookupAgentCfgForOv(req.params.id);
    if (cfg && !isOvEnabledForAgent(cfg)) {
      return res.json({ enabled: false, reason: "disabled", user: null, url: null, local: false });
    }
    const creds = resolveOvCredentials(req.params.id);
    res.json({ enabled: !!creds, user: creds?.user || null, url: creds?.url || null, local: creds ? isLocalUrl(creds.url) : false });
  });

  router.get("/agents/:id/ov/ls", requireWorkspaceRead, async (req, res) => {
    const agentId = req.params.id;
    if (workspaceIdFromAgent(agentId) !== (req.workspaceId || DEFAULT_WORKSPACE_ID)) {
      return res.status(404).json({ error: "unknown agent" });
    }
    const cfg = lookupAgentCfgForOv(agentId);
    if (cfg && !isOvEnabledForAgent(cfg)) {
      console.warn(`[ov/ls] ${agentId} ov_disabled (no env creds + no per-agent override)`);
      return res.status(403).json({ error: "ov_disabled", agentId });
    }
    const creds = resolveOvCredentials(agentId);
    if (!creds) {
      console.warn(`[ov/ls] ${agentId} no creds (openvikingApiKey=${cfg?.openvikingApiKey ? "set" : "missing"}, openvikingUrl=${cfg?.openvikingUrl || "missing"})`);
      return res.status(404).json({ error: "OV not configured for this agent" });
    }
    if (isLocalUrl(creds.url)) return res.status(400).json({ error: "local_ov", message: "OV is local — use daemon WS path" });
    const uri = req.query.uri || `viking://user/${creds.user || creds.agentId}/`;
    try {
      const data = await ovHttpList(creds, uri);
      // OV REST shape: { status: "ok", result: OvLsEntry[] }
      // OvLsEntry: { uri, size, isDir, modTime, abstract? }
      const raw = Array.isArray(data?.result) ? data.result : [];
      const entries = raw.map((e) => ({
        uri: e.uri,
        isDir: !!e.isDir,
        abstract: e.abstract,
      }));
      console.log(`[ov/ls] ${agentId} uri=${uri} → ${entries.length} entries`);
      res.json({ entries });
    } catch (e) {
      console.warn(`[ov/ls] ${agentId} uri=${uri} failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/agents/:id/ov/read", requireWorkspaceRead, async (req, res) => {
    if (workspaceIdFromAgent(req.params.id) !== (req.workspaceId || DEFAULT_WORKSPACE_ID)) {
      return res.status(404).json({ error: "unknown agent" });
    }
    const cfg = lookupAgentCfgForOv(req.params.id);
    if (cfg && !isOvEnabledForAgent(cfg)) {
      return res.status(403).json({ error: "ov_disabled", agentId: req.params.id });
    }
    const creds = resolveOvCredentials(req.params.id);
    if (!creds) return res.status(404).json({ error: "OV not configured for this agent" });
    if (isLocalUrl(creds.url)) return res.status(400).json({ error: "local_ov", message: "OV is local — use daemon WS path" });
    const uri = req.query.uri;
    if (!uri) return res.status(400).json({ error: "uri parameter required" });
    try {
      const content = await ovHttpReadContent(creds, uri, "l2");
      res.json({ content });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return {
    router,
    // Expose helpers so other modules (daemon-handler) can access them
    resolveOvCredentials,
    isLocalUrl,
    ovHttpList,
    parseOvListResult,
    ovHttpReadContent,
  };
}

module.exports = { createOvMemoryRouter };
