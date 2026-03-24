/**
 * Tournament table balancing seat logic (TDA-style):
 * - Source: move the player who will post the big blind next (currently UTG — first seat clockwise from BB).
 * - Destination: "worst" open seat = first open seat in preflop action order starting at UTG (after BB),
 *   preferring not to seat the incoming player as small blind when another open seat exists (dead SB otherwise).
 */

/**
 * @param {number} seat 1..seatsPerTable
 * @param {number} seatsPerTable
 */
export function nextClockwiseSeat(seat, seatsPerTable) {
  if (seat < 1 || seat > seatsPerTable) return seat;
  const s = seat + 1;
  return s > seatsPerTable ? 1 : s;
}

/**
 * Preflop action order starting with UTG (first seat clockwise from current BB), ending with BB.
 * @param {number} bigBlindSeat
 * @param {number} seatsPerTable
 * @returns {number[]}
 */
export function seatsInWorstPositionOrder(bigBlindSeat, seatsPerTable) {
  const out = [];
  if (
    bigBlindSeat == null ||
    bigBlindSeat < 1 ||
    bigBlindSeat > seatsPerTable
  ) {
    for (let i = 1; i <= seatsPerTable; i++) out.push(i);
    return out;
  }
  let s = nextClockwiseSeat(bigBlindSeat, seatsPerTable);
  for (let i = 0; i < seatsPerTable; i++) {
    out.push(s);
    s = nextClockwiseSeat(s, seatsPerTable);
  }
  return out;
}

/**
 * @param {Set<number>|number[]} takenSeatNumbers occupied seat numbers
 * @param {number} seatsPerTable
 * @param {number|null|undefined} bigBlindSeat
 * @param {number|null|undefined} smallBlindSeat
 * @returns {number|null} first available worst seat, or null
 */
export function pickWorstOpenSeat(
  takenSeatNumbers,
  seatsPerTable,
  bigBlindSeat,
  smallBlindSeat
) {
  const taken = takenSeatNumbers instanceof Set
    ? takenSeatNumbers
    : new Set(takenSeatNumbers);

  const order = seatsInWorstPositionOrder(bigBlindSeat, seatsPerTable);
  const openInOrder = order.filter((s) => !taken.has(s));
  if (openInOrder.length === 0) return null;

  const sb =
    smallBlindSeat != null &&
    smallBlindSeat >= 1 &&
    smallBlindSeat <= seatsPerTable
      ? smallBlindSeat
      : null;

  if (sb != null) {
    const nonSb = openInOrder.filter((s) => s !== sb);
    if (nonSb.length > 0) return nonSb[0];
  }
  return openInOrder[0];
}

/**
 * Player who will be the big blind next hand: currently UTG (first occupied seat clockwise from BB).
 * @param {{ seatNumber: number }[]} players non-eliminated live players
 * @param {number|null|undefined} bigBlindSeat
 * @param {number} seatsPerTable
 * @returns {{ seatNumber: number }|null}
 */
export function pickNextBigBlindMover(players, bigBlindSeat, seatsPerTable) {
  if (!players?.length) return null;
  const bySeat = new Map(players.map((p) => [p.seatNumber, p]));
  if (
    bigBlindSeat == null ||
    bigBlindSeat < 1 ||
    bigBlindSeat > seatsPerTable
  ) {
    return [...players].sort((a, b) => a.seatNumber - b.seatNumber)[0] ?? null;
  }
  let check = nextClockwiseSeat(bigBlindSeat, seatsPerTable);
  for (let i = 0; i < seatsPerTable; i++) {
    const pl = bySeat.get(check);
    if (pl) return pl;
    check = nextClockwiseSeat(check, seatsPerTable);
  }
  return [...players].sort((a, b) => a.seatNumber - b.seatNumber)[0] ?? null;
}
