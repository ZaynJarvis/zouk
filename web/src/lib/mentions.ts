export const MENTION_QUERY_REGEX = /@([\p{L}\p{N}_-]*)$/u;
export const MENTION_TOKEN_REGEX = /@([\p{L}\p{N}_-]+)/gu;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function toMentionHandle(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

export function buildMentionSearchTerms(...values: Array<string | undefined>): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    const normalized = normalizeWhitespace(value || '');
    if (!normalized) continue;
    terms.add(normalized.toLowerCase());
    terms.add(toMentionHandle(normalized).toLowerCase());
  }
  return [...terms];
}
