// Per-agent OV credential resolver.
//
// Single source of truth for "which OV URL + API key does this agent use?".
// All runtime paths that talk to OV (auto-recall, the /ov proxy, the tool
// proxy, memory panel routes) must go through here so that custom-mode
// agents (user-supplied URL + key) and provisioned agents (server-minted
// per-agent key) are treated the same way downstream.
//
// Returns `{ url, apiKey, account, userId, source }` or null when the agent
// has no usable creds for its current mode. The `source` field is purely
// diagnostic — useful in logs to distinguish 'custom' vs 'provisioned' vs
// 'env' fallbacks.
//
// NOTE: This function does NOT mint new keys. Provisioning happens in
// agent-lifecycle.js on agent:start; by the time anything reaches here the
// row is expected to already have either custom creds or a provisioned key.

const fs = require("fs");

function makeResolveAgentOvCreds({ decodeOvKey, deriveOvUserId, OPENVIKING_URL, OPENVIKING_ACCOUNT, isWorkspacePeerEnabled }) {
  return function resolveAgentOvCreds(cfg) {
    if (!cfg) return null;
    const mode = cfg.openvikingMode === "custom" ? "custom" : "provisioned";
    // Workspace-level opt-in to the new OV peer contract. Threaded onto every
    // resolved creds object so all downstream paths (lifecycle, proxy, tool
    // endpoint) adapt uniformly without extra plumbing.
    const peerEnabled = !!(isWorkspacePeerEnabled && isWorkspacePeerEnabled(cfg.workspaceId));

    if (mode === "custom") {
      // Custom mode: the user supplied URL + key directly. The key encodes
      // its own account; user_id falls back to the openvikingUserId override
      // or the derived agent id.
      if (cfg.openvikingCustomUrl && cfg.openvikingCustomApiKey) {
        const decoded = decodeOvKey(cfg.openvikingCustomApiKey);
        return {
          url: cfg.openvikingCustomUrl.replace(/\/+$/, ""),
          apiKey: cfg.openvikingCustomApiKey,
          account: decoded.account || "",
          userId: decoded.user || cfg.openvikingUserId || deriveOvUserId(cfg.id),
          sessionId: cfg.openvikingSessionId || null,
          peerEnabled,
          source: "custom",
        };
      }
      // Custom mode but no creds → treat as nothing configured. Don't fall
      // back to provisioned, because the agent's namespace would differ.
      return null;
    }

    // Provisioned mode: server-minted per-agent key.
    if (cfg.openvikingApiKey) {
      // URL pinning: keys live on the URL they were minted under.
      //   1. cfg.openvikingUrl — set at provision time after URL-pinning PR.
      //   2. OPENVIKING_URL env — legacy fallback for older keys minted
      //      before the column existed.
      const pinnedUrl = cfg.openvikingUrl || OPENVIKING_URL;
      if (pinnedUrl) {
        const decodedAccount = decodeOvKey(cfg.openvikingApiKey).account;
        return {
          url: pinnedUrl.replace(/\/+$/, ""),
          apiKey: cfg.openvikingApiKey,
          account: decodedAccount || OPENVIKING_ACCOUNT || "",
          userId: cfg.openvikingUserId || deriveOvUserId(cfg.id),
          sessionId: cfg.openvikingSessionId || null,
          peerEnabled,
          source: "provisioned",
        };
      }
    }

    // envVars fallback: pre-provisioning agents that ship their own
    // OPENVIKING_URL / OPENVIKING_API_KEY in envVars. Rare; kept for
    // backward compatibility with the memory-panel resolver.
    const ev = cfg.envVars;
    if (!ev) return null;
    let url = ev.OPENVIKING_URL;
    let apiKey = ev.OPENVIKING_API_KEY;
    let user = ev.OPENVIKING_USER || "";
    let account = ev.OPENVIKING_ACCOUNT || "";
    if ((!url || !apiKey) && ev.OPENVIKING_CLI_CONFIG_FILE) {
      try {
        const raw = JSON.parse(fs.readFileSync(ev.OPENVIKING_CLI_CONFIG_FILE, "utf8"));
        if (raw.url && raw.api_key) {
          url = url || raw.url;
          apiKey = apiKey || raw.api_key;
          user = user || raw.user || "";
          account = account || raw.account || "";
        }
      } catch { /* config file not accessible from server */ }
    }
    if (!url || !apiKey) return null;
    return {
      url: url.replace(/\/+$/, ""),
      apiKey,
      account,
      userId: user,
      sessionId: cfg.openvikingSessionId || null,
      peerEnabled,
      source: "env",
    };
  };
}

module.exports = { makeResolveAgentOvCreds };
