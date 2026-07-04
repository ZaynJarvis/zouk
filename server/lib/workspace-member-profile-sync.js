function defaultNormalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function collectSessionProfileNamesByEmail(authSessions, {
  normalizeEmail = defaultNormalizeEmail,
  isProfileSession = (user) => !!user && !user.guest && !!user.email && !!user.name,
} = {}) {
  const names = new Map();
  for (const user of authSessions?.values?.() || []) {
    if (!isProfileSession(user)) continue;
    const email = normalizeEmail(user.email);
    if (!email || !user.name) continue;
    // Profile rename keeps sibling sessions in sync. If old data ever has
    // conflicting session names for one email, mirror the existing auth lookup:
    // the first loaded session is treated as authoritative.
    if (!names.has(email)) names.set(email, user.name);
  }
  return names;
}

async function syncWorkspaceMemberNamesFromSessions({
  authSessions,
  workspaceMembers,
  setWorkspaceMember,
  normalizeEmail = defaultNormalizeEmail,
  normalizeWorkspaceId = (id) => id || "default",
  isProfileSession,
}) {
  if (!workspaceMembers?.entries || typeof setWorkspaceMember !== "function") return 0;
  const namesByEmail = collectSessionProfileNamesByEmail(authSessions, {
    normalizeEmail,
    isProfileSession,
  });
  if (namesByEmail.size === 0) return 0;

  const updates = [];
  for (const [workspaceId, members] of workspaceMembers.entries()) {
    if (!members?.entries) continue;
    for (const [emailKey, member] of members.entries()) {
      const email = normalizeEmail(member?.email || emailKey);
      const profileName = namesByEmail.get(email);
      if (!profileName || member?.name === profileName) continue;
      updates.push(setWorkspaceMember({
        ...member,
        workspaceId: normalizeWorkspaceId(workspaceId),
        email,
        name: profileName,
      }));
    }
  }
  if (updates.length > 0) await Promise.all(updates);
  return updates.length;
}

module.exports = {
  collectSessionProfileNamesByEmail,
  syncWorkspaceMemberNamesFromSessions,
};
