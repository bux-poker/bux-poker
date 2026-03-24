/**
 * Who may be dealt into the next hand. Rows can still say ALL_IN until DB cleanup runs;
 * excluding them caused "found 1 active player" when 2+ people had chips.
 */
export function isEligibleToDealNextHand(p) {
  if (!p || p.seatNumber == null || p.seatNumber < 0) return false;
  if (p.status === "ELIMINATED" || p.status === "FOLDED") return false;
  if ((p.chips ?? 0) <= 0) return false;
  return p.status === "ACTIVE" || p.status === "ALL_IN";
}
