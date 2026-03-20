/**
 * Normalize user ids for Set lookups and comparisons.
 * Prisma/socket may use strings while some paths used loose types — mismatches
 * caused "current player not in activePlayers" and false actedPlayersInRound hits.
 */
export function normalizeUserId(id) {
  if (id == null) return null;
  return String(id);
}
