// Per-agent opaque auth tokens.
//
// Each agent gets a stable token on first start. The token is scoped to
// (agentId, workspaceId) and lives until the agent is deleted or the token
// is explicitly revoked. No clock TTL — daemon runs for months.
//
// Token format: `sat_<32 random hex chars>` (server agent token).

const crypto = require("crypto");

function generateToken() {
  return `sat_${crypto.randomBytes(16).toString("hex")}`;
}

function createAgentAuthStore({ db }) {
  // In-memory index: token → { agentId, workspaceId }
  const tokenIndex = new Map();
  // Reverse index: agentId → token
  const agentIndex = new Map();

  return {
    async hydrateFromDb() {
      if (!db?.loadAgentTokens) return;
      const rows = await db.loadAgentTokens();
      for (const row of rows) {
        if (row.revokedAt) continue;
        tokenIndex.set(row.token, { agentId: row.agentId, workspaceId: row.workspaceId });
        agentIndex.set(row.agentId, row.token);
      }
    },

    async issue(agentId, workspaceId, { skipDb = false } = {}) {
      const existing = agentIndex.get(agentId);
      if (existing) return existing;

      const token = generateToken();
      tokenIndex.set(token, { agentId, workspaceId });
      agentIndex.set(agentId, token);
      if (!skipDb && db?.saveAgentToken) {
        await db.saveAgentToken({ token, agentId, workspaceId });
      }
      return token;
    },

    async persistToken(agentId) {
      const token = agentIndex.get(agentId);
      if (!token || !db?.saveAgentToken) return;
      const record = tokenIndex.get(token);
      if (!record) return;
      await db.saveAgentToken({ token, agentId: record.agentId, workspaceId: record.workspaceId });
    },

    resolve(token) {
      if (!token) return null;
      return tokenIndex.get(token) || null;
    },

    getTokenForAgent(agentId) {
      return agentIndex.get(agentId) || null;
    },

    async revoke(agentId) {
      const token = agentIndex.get(agentId);
      if (!token) return;
      tokenIndex.delete(token);
      agentIndex.delete(agentId);
      if (db?.revokeAgentToken) {
        await db.revokeAgentToken(agentId);
      }
    },

    // Express middleware: validates Bearer token against agent_tokens,
    // sets req.agentId and req.agentWorkspaceId on success.
    requireAgentToken() {
      return (req, res, next) => {
        const header = req.headers.authorization;
        if (!header?.startsWith("Bearer ")) {
          return res.status(401).json({ error: "Missing agent token" });
        }
        const token = header.slice(7);
        const record = tokenIndex.get(token);
        if (!record) {
          return res.status(401).json({ error: "Invalid agent token" });
        }
        // Validate agentId in path matches token scope
        const pathAgentId = req.params.agentId;
        if (pathAgentId && pathAgentId !== record.agentId) {
          return res.status(403).json({ error: "Token does not match agent" });
        }
        req.agentId = record.agentId;
        req.agentWorkspaceId = record.workspaceId;
        next();
      };
    },
  };
}

module.exports = { createAgentAuthStore };
