import type { Card } from "@shared/types/poker";

/** Parse JSON-encoded community cards from server `game-state`. */
export function parseCommunityCards(encoded: string): Card[] {
  if (!encoded) return [];
  try {
    const parsed = JSON.parse(encoded);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}
