// ─── Canonical DM channel helpers ─────────────────────────────────
// DMs use a canonical sorted-pair name: "dm:alice,zeus" so each pair
// of users shares exactly one channel regardless of who initiated.

const { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } = require("../workspaceIds");

function dmChannelName(a, b) {
  return `dm:${[a, b].sort().join(",")}`;
}

function dmChannelParties(channelName) {
  if (!channelName || !channelName.startsWith("dm:")) return null;
  return channelName.substring(3).split(",");
}

// Normalize an already-stored DM channel name so parties are sorted. Idempotent.
// Single-name rows (`dm:alice` — orphan from pre-canonical code) are returned
// as-is because we can't infer the other party without more context.
function canonicalizeDmChannelName(channelName) {
  const parties = dmChannelParties(channelName);
  if (!parties || parties.length < 2) return channelName;
  return `dm:${[...parties].sort().join(",")}`;
}

function dmPeerFrom(channelName, myName) {
  const parties = dmChannelParties(channelName);
  if (!parties || parties.length < 2) return channelName;
  return parties.find((p) => p !== myName) || parties[0];
}

function parseTarget(target, senderName) {
  // "#channel", "dm:@user", "#channel:shortid", "dm:@user:shortid",
  // or pre-canonicalized "dm:alice,zeus" / "dm:alice,zeus:shortid"
  if (!target) return { channelName: "all", channelType: "channel", threadId: null };
  if (target.startsWith("dm:")) {
    const parts = target.substring(3).split(":");
    const peer = parts[0].replace("@", "");
    let channelName;
    if (peer.includes(",")) {
      // Caller handed us a canonical-looking pair — sort to be safe.
      channelName = canonicalizeDmChannelName(`dm:${peer}`);
    } else if (senderName) {
      channelName = dmChannelName(senderName, peer);
    } else {
      channelName = `dm:${peer}`;
    }
    return { channelName, channelType: "dm", threadId: parts[1] || null, dmPeer: peer };
  }
  const parts = target.substring(1).split(":");
  return { channelName: parts[0], channelType: "channel", threadId: parts[1] || null };
}

function formatTarget(channelName, channelType, threadId) {
  if (channelType === "dm") {
    const parties = dmChannelParties(channelName);
    // For agents, format as dm:@peer; fall back to raw name
    const name = parties ? parties[0] : channelName;
    let t = `dm:@${name}`;
    if (threadId) t += `:${threadId}`;
    return t;
  }
  let t = `#${channelName}`;
  if (threadId) t += `:${threadId}`;
  return t;
}

function matchesTarget(msg, target, requesterName, workspaceId = null) {
  if (workspaceId && normalizeWorkspaceId(msg.workspaceId || DEFAULT_WORKSPACE_ID) !== normalizeWorkspaceId(workspaceId)) {
    return false;
  }
  const { channelName, channelType, threadId } = parseTarget(target, requesterName);
  // For DM without requesterName, fall back to checking if canonical names overlap
  if (channelType === "dm" && !requesterName && msg.channelType === "dm") {
    const targetParts = target.startsWith("dm:") ? [target.substring(3).split(":")[0].replace("@", "")] : [];
    const msgParties = dmChannelParties(msg.channelName);
    if (targetParts.length && msgParties) {
      return msgParties.includes(targetParts[0])
        && (threadId ? msg.threadId === threadId : !msg.threadId);
    }
  }
  return msg.channelName === channelName
    && msg.channelType === channelType
    && (threadId ? msg.threadId === threadId : !msg.threadId);
}

// taskMatchesTarget needs channelForTask which depends on store — the caller
// passes channelForTask in so this module stays store-free.
function taskMatchesTarget(task, target, agentName, channelForTask) {
  if (!target) return true;
  const { channelName, channelType } = parseTarget(target, agentName);
  const ch = channelForTask(task);
  const taskChannelName = ch?.name || task.channelName || null;
  const taskChannelType = ch?.type || (taskChannelName?.startsWith("dm:") ? "dm" : "channel");
  if (taskChannelType !== channelType) return false;
  if (taskChannelName === channelName) return true;

  // Compatibility for tasks created by older agent endpoints, which parsed
  // dm:@peer without the agent name and stored them under single-party
  // orphan channels such as dm:zaynjarvis.
  if (channelType === "dm") {
    const parties = dmChannelParties(channelName) || [];
    return parties.some((party) => taskChannelName === `dm:${party}`);
  }
  return false;
}

// Resolve a target string (e.g. "#engineering", "dm:@alice:abc12345") to the
// concrete channel row + thread filter. Returns null when the channel doesn't
// exist in the requested workspace — caller should 404 / return empty.
function resolveTargetChannel(target, requesterName, workspaceId, channels) {
  const wsId = normalizeWorkspaceId(workspaceId || DEFAULT_WORKSPACE_ID);
  const { channelName, channelType, threadId } = parseTarget(target, requesterName);
  const ch = channels.find((c) => (
    (c.workspaceId || DEFAULT_WORKSPACE_ID) === wsId
    && c.name === channelName
    && (c.type || "channel") === channelType
  ));
  if (!ch) return { channel: null, channelName, channelType, threadId };
  return { channel: ch, channelName, channelType, threadId };
}

module.exports = {
  dmChannelName,
  dmChannelParties,
  canonicalizeDmChannelName,
  dmPeerFrom,
  parseTarget,
  formatTarget,
  matchesTarget,
  taskMatchesTarget,
  resolveTargetChannel,
};
