// OV MCP thin-proxy: list tools from OV's /mcp endpoint and forward tool calls.
//
// On agent start, we expose OV's full tool set (find/search/read/list/remember/etc.)
// to agents via toolDefinitions. When an agent invokes one, the chat-bridge forwards
// to /api/agent/:id/tool/:name and we transparently call OV's /mcp endpoint with
// the agent's OV creds.

let cachedTools = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

// Session cache: one MCP session per (url, user) pair to avoid re-initializing.
const mcpSessions = new Map();

async function mcpCall(creds, method, params, id = 1) {
  const mcpUrl = `${creds.url.replace(/\/+$/, "")}/mcp`;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": `Bearer ${creds.apiKey}`,
    "X-OpenViking-Account": creds.account || "",
    "X-OpenViking-User": creds.user || "",
    "X-OpenViking-Agent": creds.agentId || "",
  };

  const sessKey = `${creds.url}:${creds.user || ""}`;
  let sessionId = mcpSessions.get(sessKey);
  if (!sessionId && method !== "initialize") {
    const initRes = await fetch(mcpUrl, {
      method: "POST", headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "zouk-server", version: "1.0" } },
        id: 1,
      }),
    });
    sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) mcpSessions.set(sessKey, sessionId);
  }
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(mcpUrl, {
    method: "POST", headers,
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
    try { return JSON.parse(text); } catch { throw new Error("OV /mcp: no data in response"); }
  }
  const parsed = JSON.parse(dataLine.slice(6));
  if (parsed.error) throw new Error(parsed.error.message || "OV /mcp error");
  return parsed;
}

// Fetch OV's full tool list. Cached server-wide (TTL 60s).
// Returns `[{ name, description, inputSchema }, ...]` shaped like our toolDefinitions.
async function fetchOvTools(rootCreds) {
  const now = Date.now();
  if (cachedTools && now - cachedAt < CACHE_TTL_MS) return cachedTools;
  if (!rootCreds?.url || !rootCreds?.apiKey) return [];

  try {
    const parsed = await mcpCall(rootCreds, "tools/list", {});
    const tools = parsed.result?.tools || [];
    cachedTools = tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {} },
    }));
    cachedAt = now;
    return cachedTools;
  } catch (err) {
    console.warn(`[ov-mcp] tools/list failed: ${err.message}`);
    return cachedTools || [];
  }
}

// Forward a tool call to OV /mcp with the agent's creds.
async function callOvTool(creds, toolName, args) {
  const parsed = await mcpCall(creds, "tools/call", { name: toolName, arguments: args }, Date.now());
  return parsed.result || { content: [{ type: "text", text: "" }] };
}

function invalidateToolCache() {
  cachedTools = null;
  cachedAt = 0;
}

function invalidateSession(creds) {
  if (!creds) return;
  mcpSessions.delete(`${creds.url}:${creds.user || ""}`);
}

module.exports = { fetchOvTools, callOvTool, invalidateToolCache, invalidateSession };
