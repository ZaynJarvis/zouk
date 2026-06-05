// OpenViking REST API client — single source of truth for request/response
// shapes against `/api/v1/*`.
//
// Every other module that touches OV REST must go through these wrappers.
// Body field names and response unwrapping live in exactly one place so that
// when the OV contract changes (or our assumption turns out to have been a
// hallucination), the fix lands in one file.
//
// Auth: callers pass a `creds` object with at least `{ url, apiKey }`. Identity
//       is derived from the Bearer key (zouk uses user-scoped keys, non-trusted
//       mode), so no X-OpenViking-* identity headers are sent.
//
// Errors: low-level `ovCall` throws on non-2xx (with `.status` and `.body`
//         attached). Typed wrappers re-throw — caller decides whether to
//         catch or let the failure propagate.

async function ovCall(creds, path, opts = {}) {
  if (!creds?.url || !creds?.apiKey) {
    throw Object.assign(new Error("ov-api: missing url/apiKey in creds"), { status: 0 });
  }
  const baseUrl = creds.url.replace(/\/+$/, "");
  const url = `${baseUrl}${path}`;
  // Identity is derived from the Bearer key alone. zouk always uses user-scoped
  // OV API keys (account.user.secret) and never OV's "trusted" mode, so the
  // X-OpenViking-Account/User/Agent headers are redundant — and the current OV
  // contract 403s on them in API-key mode ("can only assert identity in trusted
  // mode"). Never send them.
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": `Bearer ${creds.apiKey}`,
    ...(opts.headers || {}),
  };

  const fetchOpts = {
    method: opts.method || "GET",
    headers,
    cache: "no-store",
  };
  if (opts.timeout) fetchOpts.signal = AbortSignal.timeout(opts.timeout);
  if (opts.body !== undefined) {
    fetchOpts.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`OV ${res.status} ${res.statusText} on ${opts.method || "GET"} ${path}: ${body.slice(0, 200)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  // OV always returns JSON; if it doesn't we want to know.
  return await res.json();
}

// ─── GET /api/v1/fs/ls ──────────────────────────────────────────────
// Response: { status: "ok", result: OvLsEntry[] }
// OvLsEntry = { uri, size, isDir, modTime, abstract? }
async function lsDir(creds, uri, { recursive = false, timeout } = {}) {
  const params = new URLSearchParams({ uri });
  if (recursive) params.set("recursive", "true");
  const data = await ovCall(creds, `/api/v1/fs/ls?${params}`, { timeout });
  return Array.isArray(data?.result) ? data.result : [];
}

// ─── GET /api/v1/content/{read|overview|abstract} ───────────────────
// level: "l2"=read (full body), "l1"=overview, "l0"=abstract
// Response: { status: "ok", result: <string> | { content?, text?, ... } }
// Returns the unwrapped string content (empty string if nothing usable).
async function readContent(creds, uri, level = "l2", { timeout } = {}) {
  const endpoint = level === "l0" ? "abstract" : level === "l1" ? "overview" : "read";
  const data = await ovCall(creds, `/api/v1/content/${endpoint}?uri=${encodeURIComponent(uri)}`, { timeout });
  const r = data?.result;
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    return r.content ?? r.text ?? r.markdown ?? r.abstract ?? r.overview ?? r.summary ?? "";
  }
  return "";
}

// ─── POST /api/v1/search/find ───────────────────────────────────────
// Body: { query, target_uri?: string | string[], limit?, score_threshold? }
// Response: { status: "ok", result: { memories: MatchedContext[], resources: MatchedContext[], skills: MatchedContext[], total } }
// MatchedContext = { uri, context_type, level, abstract, overview?, category, score, match_reason, relations[] }
async function searchFind(creds, { query, targetUri, limit, scoreThreshold, timeout } = {}) {
  const body = { query };
  if (targetUri !== undefined) body.target_uri = targetUri;
  if (limit !== undefined) body.limit = limit;
  if (scoreThreshold !== undefined) body.score_threshold = scoreThreshold;
  const data = await ovCall(creds, "/api/v1/search/find", { method: "POST", body, timeout });
  const r = data?.result || {};
  return {
    memories: Array.isArray(r.memories) ? r.memories : [],
    resources: Array.isArray(r.resources) ? r.resources : [],
    skills: Array.isArray(r.skills) ? r.skills : [],
    total: r.total || 0,
  };
}

// ─── GET /api/v1/sessions/{id} ──────────────────────────────────────
// Response: { status: "ok", result: Session }
// Session has { ..., pending_tokens, messages[], archives[], ... }
async function getSession(creds, sessionId, { autoCreate = false, timeout } = {}) {
  const path = `/api/v1/sessions/${encodeURIComponent(sessionId)}${autoCreate ? "?auto_create=true" : ""}`;
  const data = await ovCall(creds, path, { timeout });
  return data?.result || null;
}

// ─── POST /api/v1/sessions/{id}/messages ────────────────────────────
// Body: { role: "user" | "assistant", content } OR { role, parts: [...] }
// Parts-mode carries structured tool call/result parts so the server can
// process them separately from prose; takes precedence over `content`.
// `peerId` (new peer contract) tags the message with the stable id of "the
// other party" — set it on incoming messages so commit can extract peer memory.
async function appendSessionMessage(creds, sessionId, { role, content, parts, peerId, timeout } = {}) {
  const body = parts ? { role, parts } : { role, content };
  if (peerId) body.peer_id = peerId;
  await ovCall(creds, `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body,
    timeout,
  });
}

// ─── POST /api/v1/sessions/{id}/commit ──────────────────────────────
// Empty body forces a commit regardless of pending_tokens threshold.
// `memoryPolicy` (new peer contract) overrides the session's default policy
// for this commit, e.g. { self: {enabled}, peer: {enabled} }.
async function commitSession(creds, sessionId, { memoryPolicy, timeout } = {}) {
  await ovCall(creds, `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, {
    method: "POST",
    body: memoryPolicy ? { memory_policy: memoryPolicy } : {},
    timeout,
  });
}

// ─── GET /api/v1/sessions/{id}/context ──────────────────────────────
// Response: { status: "ok", result: { latest_archive_overview, pre_archive_abstracts: string[] } }
async function getSessionContext(creds, sessionId, tokenBudget = 4000, { timeout } = {}) {
  const data = await ovCall(creds, `/api/v1/sessions/${encodeURIComponent(sessionId)}/context?token_budget=${tokenBudget}`, { timeout });
  return data?.result || null;
}

module.exports = {
  ovCall,
  lsDir,
  readContent,
  searchFind,
  getSession,
  appendSessionMessage,
  commitSession,
  getSessionContext,
};
