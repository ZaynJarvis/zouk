const DEFAULT_WORKSPACE_ID = 'default';

function normalizeWorkspaceId(raw) {
  if (typeof raw !== 'string') return DEFAULT_WORKSPACE_ID;
  let value = raw;
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      value = raw;
    }
  }
  const trimmed = value.normalize('NFKC').trim().toLowerCase();
  if (!trimmed) return DEFAULT_WORKSPACE_ID;
  return trimmed
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    || DEFAULT_WORKSPACE_ID;
}

function allocateWorkspaceId(raw, exists) {
  const baseId = normalizeWorkspaceId(raw);
  let id = baseId;
  let suffix = 2;
  while (exists(id)) {
    id = `${baseId}-${suffix++}`;
  }
  return id;
}

module.exports = {
  DEFAULT_WORKSPACE_ID,
  normalizeWorkspaceId,
  allocateWorkspaceId,
};
