// Trigger an @mention popup only when `@` starts a new word — i.e. it is at
// the very start of the input or immediately after whitespace / a newline.
// This prevents email addresses like `foo@bar.com` from opening the popup.
export const MENTION_QUERY_REGEX = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u;

// When rendering a sent message, highlight tokens that look like `@handle`.
// The leading boundary (start-of-string or whitespace) is captured in group 1
// so we can reinsert it into the rendered output. Group 2 is the handle.
export const MENTION_TOKEN_REGEX = /(^|\s)@([\p{L}\p{N}_-]+)/gu;

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

import type { AvatarStatus } from './avatarStatus';

export type MentionTarget = {
  label: string;
  mention: string;
  type: 'agent' | 'human';
  searchTerms: string[];
  picture?: string;
  online?: boolean;
  status?: AvatarStatus;
};

// Rank targets by how well they match the query.
//   0 — exact match on any term
//   1 — prefix match on any term
//   2 — substring match on any term
//   3 — no match
// Preserves input order within the same tier so the roster UX is stable.
function scoreMentionMatch(target: MentionTarget, q: string): number {
  if (!q) return 1; // empty query → treat everyone as a prefix-match so list order is preserved
  let best = 3;
  for (const term of target.searchTerms) {
    if (term === q) return 0;
    if (term.startsWith(q)) best = Math.min(best, 1);
    else if (term.includes(q)) best = Math.min(best, 2);
  }
  return best;
}

export function filterMentionTargets(targets: MentionTarget[], query: string, limit = 8): MentionTarget[] {
  const q = query.toLowerCase();
  const scored: { target: MentionTarget; score: number; order: number }[] = [];
  targets.forEach((target, order) => {
    const score = scoreMentionMatch(target, q);
    if (score < 3) scored.push({ target, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, limit).map((s) => s.target);
}
