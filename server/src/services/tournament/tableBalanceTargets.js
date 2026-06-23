/**
 * Single canonical seating distribution for N players on fixed max seats per table.
 * T = ceil(N / S). Floor(N/T) and ceil(N/T) differ by at most 1; exactly r tables have q+1 players.
 *
 * Examples (S=9): 11→[5,6], 25→[8,8,9], 63→7×9, 66→6×8+2×9.
 */

const NOT_ELIMINATED = { status: { not: "ELIMINATED" } };

/**
 * @param {number} totalPlayers
 * @param {number} seatsPerTable
 * @returns {number[]} sorted ascending, length T = ceil(totalPlayers / seatsPerTable)
 */
export function computeCanonicalTableTargets(totalPlayers, seatsPerTable) {
  const S = Math.max(1, Math.floor(seatsPerTable) || 9);
  if (totalPlayers <= 0) return [];
  const T = Math.ceil(totalPlayers / S);
  const q = Math.floor(totalPlayers / T);
  const r = totalPlayers % T;
  const out = [];
  for (let i = 0; i < T - r; i++) out.push(q);
  for (let i = 0; i < r; i++) out.push(q + 1);
  return out.sort((a, b) => a - b);
}

/**
 * @param {number[]} nonemptyCounts sorted ascending
 * @param {number} totalPlayers
 * @param {number} seatsPerTable
 */
export function countsMatchCanonical(nonemptyCounts, totalPlayers, seatsPerTable) {
  const targets = computeCanonicalTableTargets(totalPlayers, seatsPerTable);
  if (nonemptyCounts.length !== targets.length) return false;
  const c = [...nonemptyCounts].sort((a, b) => a - b);
  const t = [...targets].sort((a, b) => a - b);
  return c.every((v, i) => v === t[i]);
}

/**
 * Minimum number of "move one seated player from a fuller table to a sparser table" steps
 * needed when tables are sorted by seated count and paired with sorted canonical targets
 * (same multiset sum; greedy largest→smallest reaches canonical in this many moves or fewer).
 *
 * @param {number[]} actualSorted
 * @param {number[]} targetSorted
 */
export function minBalanceMovesSortedMatch(actualSorted, targetSorted) {
  if (actualSorted.length !== targetSorted.length) return 0;
  let m = 0;
  for (let i = 0; i < actualSorted.length; i++) {
    m += Math.max(0, actualSorted[i] - targetSorted[i]);
  }
  return m;
}

/**
 * @param {{ id: string, players?: { length: number }[], tableNumber?: number }[]} activeGames
 * @param {number} seatsPerTable
 * @returns {{ total: number, T: number, nonempty: typeof activeGames, needCloseEmptyShells: boolean, distributionOk: boolean }}
 */
export function analyzeTableBalance(activeGames, seatsPerTable) {
  const S = Math.max(1, Math.floor(seatsPerTable) || 9);
  const nonempty = (activeGames || []).filter(
    (g) => (g.players?.length ?? 0) > 0
  );
  const total = nonempty.reduce((s, g) => s + (g.players?.length ?? 0), 0);
  const T = Math.max(1, Math.ceil(total / S));
  const needCloseEmptyShells = (activeGames?.length ?? 0) > T;
  const counts = nonempty.map((g) => g.players.length).sort((a, b) => a - b);
  const distributionOk =
    nonempty.length === T &&
    countsMatchCanonical(counts, total, S);
  return {
    total,
    T,
    nonempty,
    needCloseEmptyShells,
    distributionOk,
    targets: computeCanonicalTableTargets(total, S),
  };
}

/** Everyone left in the tournament fits on one table — must merge before dealing. */
export function isFinalTablePhase(totalPlayers, seatsPerTable) {
  const S = Math.max(1, Math.floor(seatsPerTable) || 9);
  return totalPlayers > 1 && totalPlayers <= S;
}

/**
 * @param {{ id: string, players?: { length: number }[], tableNumber?: number }[]} activeGames
 * @param {number} seatsPerTable
 * @param {number|null} tournamentLiveTotal all non-eliminated in event (incl. off ACTIVE tables)
 */
export function tournamentNeedsConsolidation(
  activeGames,
  seatsPerTable,
  tournamentLiveTotal = null
) {
  const a = analyzeTableBalance(activeGames, seatsPerTable);
  const liveTotal = tournamentLiveTotal ?? a.total;

  if (tournamentLiveTotal != null && tournamentLiveTotal !== a.total) {
    return true;
  }

  if (isFinalTablePhase(liveTotal, seatsPerTable)) {
    if (a.nonempty.length !== 1) return true;
    if (a.nonempty[0].players.length !== liveTotal) return true;
  }

  return a.needCloseEmptyShells || !a.distributionOk;
}

/**
 * Source = table with most seated players, destination = fewest (one chip-positive mover per txn).
 * @param {{ id: string, players?: unknown[], tableNumber?: number }[]} activeGames — non-eliminated players populated
 * @param {number} seatsPerTable
 * @returns {{ srcGame: object, dstGame: object } | null}
 */
export function pickBalanceEndpoints(games, seatsPerTable) {
  const nonempty = games.filter((g) => (g.players?.length ?? 0) > 0);
  const total = nonempty.reduce((s, g) => s + g.players.length, 0);
  const S = Math.max(1, Math.floor(seatsPerTable) || 9);
  const T = Math.max(1, Math.ceil(total / S));
  if (nonempty.length !== T) return null;

  const targets = computeCanonicalTableTargets(total, S);
  const items = nonempty.map((g) => ({ g, n: g.players.length }));
  const sorted = [...items].sort((a, b) =>
    a.n !== b.n ? a.n - b.n : (a.g.tableNumber ?? 0) - (b.g.tableNumber ?? 0)
  );
  if (sorted.length !== targets.length) return null;
  if (sorted.every((x, i) => x.n === targets[i])) return null;

  const largest = items.reduce((a, b) => (b.n > a.n ? b : a));
  const smallest = items.reduce((a, b) => (b.n < a.n ? b : a));
  if (largest.g.id === smallest.g.id) return null;
  return { srcGame: largest.g, dstGame: smallest.g };
}

export async function countTournamentLivePlayers(tournamentId) {
  const { prisma } = await import("../../config/database.js");
  return prisma.player.count({
    where: { game: { tournamentId }, status: { not: "ELIMINATED" } },
  });
}

/**
 * Tournament tables must match the canonical multiset before a new hand is dealt.
 * Uses full tournament headcount (not only ACTIVE tables) so stranded rows cannot
 * trigger short-handed deals while others sit on COMPLETED games.
 */
export async function canStartHandOnTournamentTable(tournamentId, gameId) {
  const { prisma } = await import("../../config/database.js");
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { seatsPerTable: true },
  });
  const seatsPerTable = tournament?.seatsPerTable ?? 9;

  const tournamentLiveTotal = await countTournamentLivePlayers(tournamentId);

  const strandedLive = await prisma.player.count({
    where: {
      game: { tournamentId, status: { not: "ACTIVE" } },
      status: { not: "ELIMINATED" },
    },
  });
  if (strandedLive > 0) {
    return { allowed: false, reason: "players_off_active_tables" };
  }

  const games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: {
        where: NOT_ELIMINATED,
        select: { id: true },
      },
    },
    orderBy: { tableNumber: "asc" },
  });

  const gameRow = games.find((g) => g.id === gameId);
  if (!gameRow || gameRow.players.length === 0) {
    return { allowed: false, reason: "no_seated_players" };
  }

  const { total, needCloseEmptyShells, distributionOk, nonempty } =
    analyzeTableBalance(games, seatsPerTable);

  if (tournamentLiveTotal < 2) {
    return { allowed: false, reason: "tournament_not_ready" };
  }

  if (total !== tournamentLiveTotal) {
    return { allowed: false, reason: "players_off_active_tables" };
  }

  if (isFinalTablePhase(tournamentLiveTotal, seatsPerTable)) {
    if (nonempty.length !== 1) {
      return { allowed: false, reason: "final_table_merge" };
    }
    if (nonempty[0].players.length !== tournamentLiveTotal) {
      return { allowed: false, reason: "final_table_merge" };
    }
    if (nonempty[0].id !== gameId) {
      return { allowed: false, reason: "final_table_merge" };
    }
    return { allowed: true };
  }

  if (needCloseEmptyShells && !distributionOk) {
    return { allowed: false, reason: "merging_tables" };
  }
  if (needCloseEmptyShells && distributionOk) {
    const onNonempty = nonempty.some((g) => g.id === gameId);
    return onNonempty
      ? { allowed: true }
      : { allowed: false, reason: "awaiting_table_balance" };
  }
  if (!distributionOk) {
    return { allowed: false, reason: "awaiting_table_balance" };
  }
  return { allowed: true };
}
