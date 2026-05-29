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
    // Attach the HTTP status so callers can distinguish a 409 (user already
    // exists — same-named agent recreated) from a hard failure and recover by
    // reusing the existing user's key (see fetchExistingAgentKey).
    throw Object.assign(
      new Error(`OV admin ${res.status}${excerpt ? `: ${excerpt}` : ""}`),
      { status: res.status }
    );
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

// Look up an already-provisioned user's key by listing the account's users and
// matching on user_id. OV exposes no GET-single-user endpoint (it 405s), so we
// list and filter. Used to recover the key when provisioning hits a 409: a
// same-named agent was recreated, and we want it to inherit the prior agent's
// OV namespace (memory) rather than run keyless. Returns the user_key string,
// or null if no matching user is found.
async function fetchExistingAgentKey({ url, account, rootApiKey, agentId }) {
  const endpoint = `${url}/api/v1/admin/accounts/${encodeURIComponent(account)}/users`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: { "Authorization": `Bearer ${rootApiKey}` },
  });
  if (!res.ok) {
    const excerpt = await readBodyExcerpt(res);
    throw new Error(`OV admin list ${res.status}${excerpt ? `: ${excerpt}` : ""}`);
  }
  const body = await res.json();
  const users = Array.isArray(body?.result) ? body.result : [];
  const match = users.find((u) => u && u.user_id === agentId);
  if (!match) return null;
  // List entries carry the key under `api_key`; provision responses use
  // `user_key`. Accept either so this keeps working if the shapes converge.
  const key = match.api_key || match.user_key || null;
  return key || null;
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

module.exports = { provisionAgentKey, fetchExistingAgentKey, revokeAgentKey };
