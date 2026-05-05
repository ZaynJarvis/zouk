// OpenViking admin API client — used by the agent-start handler to mint
// per-agent user_keys via the server's root API key.

async function readBodyExcerpt(res) {
  try {
    const text = await res.text();
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return "";
  }
}

async function provisionAgentKey({ url, account, rootApiKey, agentId, role = "user" }) {
  const endpoint = `${url}/api/v1/admin/accounts/${encodeURIComponent(account)}/users`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${rootApiKey}`,
    },
    body: JSON.stringify({ user_id: agentId, role }),
  });
  if (!res.ok) {
    const excerpt = await readBodyExcerpt(res);
    throw new Error(`OV admin ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
  }
  const body = await res.json();
  if (body.status !== "ok" || !body.result) {
    throw new Error(`OV admin returned status=${body.status}`);
  }
  const { user_key, user_id, account_id } = body.result;
  if (!user_key || !user_id) {
    throw new Error("OV admin response missing user_key/user_id");
  }
  return { user_key, user_id, account_id };
}

async function revokeAgentKey({ url, account, rootApiKey, agentId }) {
  const endpoint = `${url}/api/v1/admin/accounts/${encodeURIComponent(account)}/users/${encodeURIComponent(agentId)}`;
  const res = await fetch(endpoint, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${rootApiKey}` },
  });
  if (!res.ok) {
    const excerpt = await readBodyExcerpt(res);
    throw new Error(`OV admin ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
  }
}

module.exports = { provisionAgentKey, revokeAgentKey };
