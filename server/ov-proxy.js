// Transparent OpenViking proxy — substitutes auth headers, forwards everything
// else unchanged. Agents hit /ov/* on zouk-server; this module rewrites the
// auth to per-agent OV credentials and proxies to the real OV server.
//
// Supports:
//   /ov/api/v1/*  — REST API
//   /ov/mcp       — MCP endpoint
//   /ov/health    — health check

const { Router } = require("express");

function createOvProxy({ agentAuth, getAgentOvCreds, resolveOvUrl }) {
  const router = Router();

  // Resolve OV URL + per-agent OV creds from the agent token.
  // Returns { ovUrl, ovApiKey, ovAccount, ovUserId } or null.
  function resolveAgent(req) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;

    const token = header.slice(7);
    const record = agentAuth.resolve(token);
    if (!record) return null;

    const creds = getAgentOvCreds(record.agentId);
    if (!creds?.apiKey) return null;

    const ovUrl = creds.url || resolveOvUrl(record.workspaceId);
    if (!ovUrl) return null;

    return {
      agentId: record.agentId,
      workspaceId: record.workspaceId,
      ovUrl: ovUrl.replace(/\/+$/, ""),
      ovApiKey: creds.apiKey,
      ovAccount: creds.account || "",
      ovUserId: creds.userId || "",
    };
  }

  async function proxyRequest(req, res) {
    const agent = resolveAgent(req);
    if (!agent) {
      return res.status(401).json({ error: "Cannot resolve OV credentials for this agent" });
    }

    // Build target URL: strip /ov prefix, forward to OV server
    const ovPath = req.originalUrl.replace(/^\/ov/, "");
    const targetUrl = `${agent.ovUrl}${ovPath}`;

    const headers = { ...req.headers };
    // Replace auth headers
    headers["authorization"] = `Bearer ${agent.ovApiKey}`;
    headers["x-openviking-account"] = agent.ovAccount;
    headers["x-openviking-user"] = agent.ovUserId;
    headers["x-openviking-agent"] = agent.agentId;
    // Remove hop-by-hop headers
    delete headers["host"];
    delete headers["connection"];
    delete headers["transfer-encoding"];

    try {
      const fetchOpts = {
        method: req.method,
        headers,
      };
      if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
        fetchOpts.body = JSON.stringify(req.body);
        headers["content-type"] = "application/json";
      }

      const upstream = await fetch(targetUrl, fetchOpts);

      // Forward status + content-type
      res.status(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct) res.set("content-type", ct);

      // Stream body
      if (upstream.body) {
        const reader = upstream.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        };
        await pump();
      } else {
        const text = await upstream.text();
        res.send(text);
      }
    } catch (err) {
      console.error(`[ov-proxy] ${req.method} ${ovPath} failed:`, err.message);
      res.status(502).json({ error: "OV proxy error", detail: err.message });
    }
  }

  router.all("/api/v1/*", proxyRequest);
  router.all("/mcp", proxyRequest);
  router.get("/health", proxyRequest);

  return router;
}

module.exports = { createOvProxy };
