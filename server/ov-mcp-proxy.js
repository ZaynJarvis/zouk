// OV MCP thin-proxy: list tools from OV's /mcp endpoint and forward tool calls.
//
// On agent start, we expose OV's full tool set (find/search/read/list/remember/etc.)
// to agents via toolDefinitions. When an agent invokes one, the chat-bridge forwards
// to /api/agent/:id/tool/:name and we transparently call OV's /mcp endpoint with
// the agent's OV creds.

const crypto = require("crypto");

const CACHE_TTL_MS = 60_000;
const SESSION_TTL_MS = 30 * 60_000; // 30 min

// Tool cache: per-URL to avoid cross-OV contamination.
// Map url -> { tools, cachedAt }
const toolCache = new Map();

// Session cache: one MCP session per (url, user, apiKey) triple.
// The apiKey is hashed so the raw key never sits in a Map key.
// Map key -> { sessionId, lastUsed }
const mcpSessions = new Map();

function sessionKey(creds) {
  const keyHash = crypto
    .createHash("sha256")
    .update(creds.apiKey || "")
    .digest("hex")
    .slice(0, 16);
  return `${creds.url}:${creds.user || ""}:${keyHash}`;
}

function evictStaleSessions() {
  const now = Date.now();
  for (const [k, v] of mcpSessions) {
    if (now - v.lastUsed > SESSION_TTL_MS) mcpSessions.delete(k);
  }
}

async function mcpCall(creds, method, params, id = 1) {
  const mcpUrl = `${creds.url.replace(/\/+$/, "")}/mcp`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${creds.apiKey}`,
  };

  evictStaleSessions();

  const sessKey = sessionKey(creds);
  const cached = mcpSessions.get(sessKey);
  let sessionId = cached?.sessionId;
  if (cached) cached.lastUsed = Date.now();

  if (!sessionId && method !== "initialize") {
    const initRes = await fetch(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "zouk-server", version: "1.0" },
        },
        id: 1,
      }),
    });
    sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) {
      mcpSessions.set(sessKey, { sessionId, lastUsed: Date.now() });
    }
  }
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OV /mcp ${res.status}: ${body.slice(0, 200)}`);
  }

  // OV streams responses as SSE; pick the data line.
  const text = await res.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("OV /mcp: no data in response");
    }
  }
  const parsed = JSON.parse(dataLine.slice(6));
  if (parsed.error) throw new Error(parsed.error.message || "OV /mcp error");
  return parsed;
}

// Fetch OV's full tool list. Cached per-URL (TTL 60s).
// Returns `[{ name, description, inputSchema }, ...]` shaped like our toolDefinitions.
async function fetchOvTools(rootCreds) {
  const now = Date.now();
  const url = rootCreds?.url;
  if (!url || !rootCreds?.apiKey) return [];

  const cached = toolCache.get(url);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.tools;

  try {
    const parsed = await mcpCall(rootCreds, "tools/list", {});
    const tools = (parsed.result?.tools || []).map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {} },
    }));
    toolCache.set(url, { tools, cachedAt: now });
    return tools;
  } catch (err) {
    console.warn(`[ov-mcp] tools/list failed: ${err.message}`);
    return cached?.tools || [];
  }
}

// Forward a tool call to OV /mcp with the agent's creds.
async function callOvTool(creds, toolName, args) {
  const parsed = await mcpCall(
    creds,
    "tools/call",
    { name: toolName, arguments: args },
    Date.now()
  );
  return parsed.result || { content: [{ type: "text", text: "" }] };
}

function invalidateToolCache(url) {
  if (url) {
    toolCache.delete(url);
  } else {
    toolCache.clear();
  }
}

function invalidateSession(creds) {
  if (!creds) return;
  mcpSessions.delete(sessionKey(creds));
}

// Exported for tests
function _sessionsSize() {
  return mcpSessions.size;
}
function _toolCacheSize() {
  return toolCache.size;
}
function _clearAll() {
  mcpSessions.clear();
  toolCache.clear();
}

module.exports = {
  fetchOvTools,
  callOvTool,
  invalidateToolCache,
  invalidateSession,
  SESSION_TTL_MS,
  CACHE_TTL_MS,
  _sessionsSize,
  _toolCacheSize,
  _clearAll,
};
