function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function agentEntries(agentsById) {
  if (!agentsById) return [];
  if (agentsById instanceof Map) return [...agentsById.entries()];
  return Object.entries(agentsById);
}

function mentionAliases(...values) {
  const aliases = new Set();
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    aliases.add(trimmed);
    aliases.add(trimmed.replace(/\s+/g, "_"));
  }
  return [...aliases].map((alias) => alias.toLowerCase());
}

function agentMatchesMention(agent, mention) {
  const normalizedMention = normalize(mention);
  if (!normalizedMention) return false;
  return mentionAliases(agent?.name, agent?.displayName).includes(normalizedMention);
}

function extractMentions(content) {
  const mentions = [];
  const regex = /@([\p{L}\p{N}_-]+)/gu;
  let match;
  while ((match = regex.exec(String(content || ""))) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return mentions;
}

function findAgentIdByName(name, agentsById) {
  const lowered = normalize(name);
  if (!lowered) return null;
  for (const [agentId, agent] of agentEntries(agentsById)) {
    if (normalize(agentId) === lowered) return agentId;
    if (normalize(agent?.name) === lowered) return agentId;
    if (normalize(agent?.displayName) === lowered) return agentId;
  }
  return null;
}

function explicitMentionAgentIds(content, agentsById) {
  const ids = new Set();
  const mentions = extractMentions(content);
  if (mentions.length === 0) return ids;
  for (const mention of mentions) {
    for (const [agentId, agent] of agentEntries(agentsById)) {
      if (agentMatchesMention(agent, mention)) ids.add(agentId);
    }
  }
  return ids;
}

function keywordAgentIds(content, agentsById) {
  const ids = new Set();
  const haystack = normalize(content);
  if (!haystack) return ids;
  for (const [agentId, agent] of agentEntries(agentsById)) {
    // Product decision for large-channel routing: canonical agent.name,
    // case-insensitive substring, no word-boundary guard.
    const name = normalize(agent?.name);
    if (name && haystack.includes(name)) ids.add(agentId);
  }
  return ids;
}

function directedAgentIds(content, agentsById, { includeKeyword = false } = {}) {
  const ids = explicitMentionAgentIds(content, agentsById);
  if (includeKeyword) {
    for (const agentId of keywordAgentIds(content, agentsById)) ids.add(agentId);
  }
  return ids;
}

function messageInvolvedAgentIds(message, agentsById, { includeKeyword = true } = {}) {
  const ids = directedAgentIds(message?.content || "", agentsById, { includeKeyword });
  if (message?.senderType === "agent") {
    const senderId = findAgentIdByName(message.senderName, agentsById);
    if (senderId) ids.add(senderId);
  }
  if (message?.taskAssigneeType === "agent" && message.taskAssigneeId) {
    ids.add(message.taskAssigneeId);
  }
  return ids;
}

module.exports = {
  agentMatchesMention,
  directedAgentIds,
  explicitMentionAgentIds,
  extractMentions,
  findAgentIdByName,
  keywordAgentIds,
  mentionAliases,
  messageInvolvedAgentIds,
};
