// Username rules shared by the registration UI. These mirror the server's
// USERNAME_CHARSET / isNameTaken (server/index.js): a display name is used
// verbatim as the user's OV peer_id, so it must fit this charset and stay unique
// across the @mention / DM / peer_id namespace. The server stays authoritative —
// this only gives instant feedback before the round-trip.
import type { ServerAgent, ServerHuman } from '../types';

export const USERNAME_CHARSET = /^[a-zA-Z0-9_.@-]+$/;

export function isValidUsername(name: string): boolean {
  return USERNAME_CHARSET.test(name.trim());
}

// Lowercased set of names already owned by a participant — humans plus agents
// (including agent display names), since all of them share the namespace.
export function takenNameSet(humans: ServerHuman[], agents: ServerAgent[]): Set<string> {
  const taken = new Set<string>();
  for (const h of humans) if (h?.name) taken.add(h.name.trim().toLowerCase());
  for (const a of agents) {
    if (a?.name) taken.add(a.name.trim().toLowerCase());
    if (a?.displayName) taken.add(a.displayName.trim().toLowerCase());
  }
  return taken;
}

// Whether `name` is taken by someone other than `selfName` (case-insensitive).
export function isNameTakenLocally(name: string, taken: Set<string>, selfName?: string): boolean {
  const lowered = name.trim().toLowerCase();
  if (!lowered) return false;
  if (selfName && lowered === selfName.trim().toLowerCase()) return false;
  return taken.has(lowered);
}
