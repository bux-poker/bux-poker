/**
 * Single canonical seating distribution for N players on fixed max seats per table.
 * T = ceil(N / S). Floor(N/T) and ceil(N/T) differ by at most 1; exactly r tables have q+1 players.
 *
 * Examples (S=9): 11→[5,6], 25→[8,8,9], 63→7×9, 66→6×8+2×9.
 */

import { prisma } from "../../config/database.js";

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

/**
 * @param {{ id: string, players?: { length: number }[], tableNumber?: number }[]} activeGames
 * @param {number} seatsPerTable
 */
export function tournamentNeedsConsolidation(activeGames, seatsPerTable) {
  const a = analyzeTableBalance(activeGames, seatsPerTable);
  return a.needCloseEmptyShells || !a.distributionOk;
}

/**
 * Source = table with most seated players, destination = fewest (one chip-positive mover per run).
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

/**
 * Tournament tables must match the canonical multiset before a new hand is dealt.
 * Exception: extra empty ACTIVE shells while nonempty tables are already canonical — close shells in parallel.
 * @param {string} tournamentId
 * @param {string} gameId
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function canStartHandOnTournamentTable(tournamentId, gameId) {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { seatsPerTable: true },
  });
  const seatsPerTable = tournament?.seatsPerTable ?? 9;

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

  const { total, needCloseEmptyShells, distributionOk } = analyzeTableBalance(
    games,
    seatsPerTable
  );

  if (total < 2) {
    return { allowed: false, reason: "tournament_not_ready" };
  }

  if (needCloseEmptyShells && !distributionOk) {
    return { allowed: false, reason: "merging_tables" };
  }
  if (needCloseEmptyShells && distributionOk) {
    return { allowed: true };
  }
  if (!distributionOk) {
    return { allowed: false, reason: "awaiting_table_balance" };
  }
  return { allowed: true };
}
