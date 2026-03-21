import { prisma } from "../../config/database.js";
import { auditChipConservation } from "./chipAudit.js";
import { resyncGamesToMaxBlindLevel } from "./blindLevels.js";

const _consolidationLocks = new Map();

/** Tournament IDs for which we are currently waiting for all hands to finish (so do not start new hands). */
const _consolidationWaitTournamentIds = new Set();

export function isTournamentConsolidationWaiting(tournamentId) {
  return _consolidationWaitTournamentIds.has(tournamentId);
}

/**
 * Wait for all tables to finish their current hands. If a hand is stuck 90s+, force current player to act.
 * @param {string} tournamentId
 * @param {{ hasActiveHand: (gameId: string) => Promise<boolean>, forceStuckPlayerToAct: (gameId: string, io: object) => Promise<boolean>, getIO: () => object }} deps
 */
export function waitForAllTablesToFinishHands(tournamentId, deps) {
  const checkInterval = 2000;
  const stuckThresholdMs = 90000;
  const activeSince = new Map();

  return new Promise((resolve) => {
    const checkHands = async () => {
      const games = await prisma.game.findMany({
        where: { tournamentId, status: "ACTIVE" },
        include: { players: true }
      });

      let allHandsFinished = true;
      for (const game of games) {
        const hasHand = await deps.hasActiveHand(game.id);
        if (hasHand) {
          const now = Date.now();
          if (!activeSince.has(game.id)) activeSince.set(game.id, now);
          const stuckForMs = now - activeSince.get(game.id);
          const waitingFor = stuckForMs / 1000;
          allHandsFinished = false;

          if (stuckForMs >= stuckThresholdMs) {
            try {
              const io = deps.getIO();
              const ok = await deps.forceStuckPlayerToAct(game.id, io);
              if (ok) {
                console.log(`[TOURNAMENT] Table ${game.tableNumber} hand stuck ${waitingFor.toFixed(0)}s - forced player to act`);
                activeSince.delete(game.id);
              }
            } catch (e) {
              console.warn(`[TOURNAMENT] Force-stuck failed for table ${game.tableNumber}:`, e?.message);
            }
          } else {
            console.log(`[TOURNAMENT] Table ${game.tableNumber} still has active hand, waiting... (${waitingFor.toFixed(0)}s)`);
          }
          // Do not break: force every stuck table this cycle so all make progress
        } else {
          activeSince.delete(game.id);
        }
      }

      if (allHandsFinished) {
        console.log(`[TOURNAMENT] All tables have finished their hands, proceeding with rebalancing`);
        resolve(true);
        return;
      }

      setTimeout(checkHands, checkInterval);
    };

    checkHands();
  });
}

/**
 * Inner consolidation logic: rebalance players across tables, clear state, reseat, sync blinds, start hands.
 * @param {string} tournamentId
 * @param {object} deps - hasActiveHand, getIO, clearAllStateForGames, startHandForGame
 */
export async function doConsolidateTables(tournamentId, deps) {
  console.log(`[TOURNAMENT] Starting table consolidation for tournament ${tournamentId}`);

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { seatsPerTable: true }
  });
  const seatsPerTable = tournament?.seatsPerTable ?? 9;

  let games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: {
        where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
        include: { user: true }
      }
    },
    orderBy: { tableNumber: "asc" }
  });

  const totalCount = games.reduce((sum, g) => sum + (g.players?.length ?? 0), 0);
  const tablesNeeded = Math.max(1, Math.ceil(totalCount / seatsPerTable));
  const counts = games.map(g => g.players?.length ?? 0).filter(c => c > 0);
  const maxC = counts.length ? Math.max(...counts) : 0;
  const minC = counts.length ? Math.min(...counts) : 0;
  const spread = maxC - minC;

  const maxSpread = 1;
  if (games.length <= tablesNeeded && spread <= maxSpread) {
    console.log(`[TOURNAMENT] Skipping consolidation: ${games.length} tables, counts ${counts.join(",")}, spread ${spread} (no rebalance needed)`);
    return games;
  }

  // Block new hands for this tournament for the whole consolidation window (not only when we first
  // saw an active hand). Otherwise idle poll can start a hand during the 2s delay / DB work and
  // we clear tableState mid-hand → chip loss (see hasActiveHand false-negatives + DB/async races).
  _consolidationWaitTournamentIds.add(tournamentId);
  try {
  const anyHasHand = await Promise.all(games.map((g) => deps.hasActiveHand(g.id))).then((arr) => arr.some(Boolean));
  if (anyHasHand) {
    console.log(`[TOURNAMENT] Consolidation needed (${games.length} tables, counts ${counts.join(",")}, spread ${spread}). Waiting for all hands to finish...`);
    try {
      const io = deps.getIO();
      if (io) {
        for (const g of games) {
          io.to(`game:${g.id}`).emit("consolidation-waiting", {
            message: "Waiting for other tables to finish their hands before reseating...",
            tournamentId
          });
        }
        // Push game-state so clients get consolidationWaitingMessage (socket event alone is easy to miss;
        // startHand is blocked so nothing else emits until hands finish).
        try {
          const { emitGameState } = await import("../../modules/poker/emitGameState.js");
          const { tableState } = await import("../../modules/poker/tableState.js");
          for (const g of games) {
            const st = tableState.get(g.id);
            await emitGameState(g.id, io, st ?? null);
          }
        } catch (e) {
          console.warn("[TOURNAMENT] Could not emit game-state during consolidation wait:", e?.message);
        }
      }
      await waitForAllTablesToFinishHands(tournamentId, deps);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.warn("[TOURNAMENT] Consolidation wait error:", e?.message);
    }
  } else {
    await new Promise((r) => setTimeout(r, 2000));
  }

  games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: {
        where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
        include: { user: true }
      }
    },
    orderBy: { tableNumber: "asc" }
  });

  const hasHandAfterWait = await Promise.all(games.map((g) => deps.hasActiveHand(g.id))).then((arr) => arr.some(Boolean));
  if (hasHandAfterWait) {
    console.log(`[TOURNAMENT] Consolidation aborted: a hand started during wait; will retry next poll`);
    return games;
  }

  console.log(`[TOURNAMENT] Consolidation: found ${games.length} ACTIVE table(s), player counts (in-tournament):`, games.map(g => `${g.tableNumber}:${g.players?.length ?? 0}`));

  const allActiveGameIdsForClear = games.map(g => g.id);

  const allPlayers = [];
  for (const game of games) {
    for (const player of game.players) {
      allPlayers.push({
        playerId: player.id,
        gameId: game.id,
        userId: player.userId,
        chips: player.chips,
        seatNumber: player.seatNumber,
        player
      });
    }
  }

  const totalPlayers = allPlayers.length;
  const numTablesNeeded = Math.max(1, Math.ceil(totalPlayers / seatsPerTable));

  if (games.length > numTablesNeeded) {
    const byPlayerCount = [...games].sort((a, b) => (a.players?.length ?? 0) - (b.players?.length ?? 0));
    const toClose = byPlayerCount.slice(0, byPlayerCount.length - numTablesNeeded);
    const toKeep = byPlayerCount.slice(-numTablesNeeded);
    for (const g of toClose) {
      const hasHand = await deps.hasActiveHand(g.id);
      if (hasHand) {
        console.warn(`[TOURNAMENT] Cannot close table ${g.tableNumber} - has active hand (likely all-in players); skipping consolidation`);
        return games;
      }
      const orphanPot = g.pot ?? 0;
      if (orphanPot > 0) {
        const fromGame = allPlayers.filter((ap) => ap.gameId === g.id);
        if (fromGame.length > 0) {
          const recipient = fromGame[0];
          recipient.chips = (recipient.chips ?? 0) + orphanPot;
          recipient.player.chips = recipient.chips;
          console.log(`[TOURNAMENT] Transferring orphan pot ${orphanPot} from closed game ${g.id} (table ${g.tableNumber}) to player ${recipient.playerId} (chips now ${recipient.chips})`);
        } else {
          console.error(`[TOURNAMENT] Cannot transfer pot ${orphanPot} from game ${g.id} - no players in list; chips will be lost`);
        }
      }
      await prisma.game.update({ where: { id: g.id }, data: { status: "COMPLETED", pot: 0 } });
    }
    games = toKeep;
    console.log(`[TOURNAMENT] Reduced to ${numTablesNeeded} table(s) (closed ${toClose.length} emptiest)`);
  }

  games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: {
        where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
        include: { user: true },
      },
    },
    orderBy: { tableNumber: "asc" },
  });

  const totalPlayersLive = games.reduce((s, g) => s + (g.players?.length ?? 0), 0);
  if (totalPlayersLive === 0) {
    console.log(`[TOURNAMENT] No players remaining, skipping redistribution`);
    return games;
  }

  const countsLive = games.map((g) => g.players?.length ?? 0).filter((c) => c > 0);
  const maxLive = countsLive.length ? Math.max(...countsLive) : 0;
  const minLive = countsLive.length ? Math.min(...countsLive) : 0;
  const spreadLive = maxLive - minLive;

  console.log(
    `[TOURNAMENT] Live counts: ${games.map((g) => `${g.tableNumber}:${g.players?.length ?? 0}`).join(", ")} — spread ${spreadLive}`
  );

  for (const gameId of allActiveGameIdsForClear) {
    if (await deps.hasActiveHand(gameId)) {
      console.warn(`[TOURNAMENT] Aborting consolidation: game ${gameId} has active hand (started during wait)`);
      return games;
    }
  }

  const gamesWithDbPot = await prisma.game.findMany({
    where: { id: { in: allActiveGameIdsForClear }, pot: { gt: 0 } },
    select: { id: true, pot: true, tableNumber: true }
  });
  if (gamesWithDbPot.length > 0) {
    console.warn(
      `[TOURNAMENT] Aborting consolidation: DB pot > 0 (hand may still be settling): ${gamesWithDbPot.map((g) => `table${g.tableNumber}:${g.pot}`).join(", ")}`
    );
    return games;
  }

  try {
    deps.clearAllStateForGames(allActiveGameIdsForClear);
  } catch (e) {
    console.warn("[TOURNAMENT] Could not clear game state:", e?.message);
  }

  if (spreadLive <= 1) {
    console.log(`[TOURNAMENT] Spread ≤ 1 — no player moves (seats unchanged except closed tables)`);
  } else {
    await prisma.$transaction(async (tx) => {
      let guard = 0;
      while (guard++ < 200) {
        const gs = await tx.game.findMany({
          where: { tournamentId, status: "ACTIVE" },
          include: {
            players: {
              where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
              orderBy: { seatNumber: "asc" },
            },
          },
          orderBy: { tableNumber: "asc" },
        });
        const active = gs.filter((g) => (g.players?.length ?? 0) > 0);
        if (active.length < 2) break;
        const sizes = active.map((g) => ({ g, n: g.players.length }));
        const mx = Math.max(...sizes.map((s) => s.n));
        const mn = Math.min(...sizes.map((s) => s.n));
        if (mx - mn <= 1) break;

        const maxTables = sizes
          .filter((s) => s.n === mx)
          .sort((a, b) => b.g.tableNumber - a.g.tableNumber);
        const minTables = sizes
          .filter((s) => s.n === mn)
          .sort((a, b) => a.g.tableNumber - b.g.tableNumber);
        const src = maxTables[0].g;
        const dst = minTables[0].g;

        const taken = new Set(dst.players.map((p) => p.seatNumber));
        let seat = 1;
        while (seat <= seatsPerTable && taken.has(seat)) seat++;
        if (seat > seatsPerTable) {
          throw new Error(
            `[TOURNAMENT] No free seat on table ${dst.tableNumber} (seatsPerTable=${seatsPerTable})`
          );
        }

        const pi = Math.floor(Math.random() * src.players.length);
        const mover = src.players[pi];

        await tx.player.update({
          where: { id: mover.id },
          data: { gameId: dst.id, seatNumber: seat },
        });
        console.log(
          `[TOURNAMENT] Balance: moved user ${mover.userId} from table ${src.tableNumber} → ${dst.tableNumber} seat ${seat}`
        );
      }
    });
  }

  const updatedGames = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: {
        where: { status: "ACTIVE" }
      }
    }
  });

  const playerCounts = updatedGames.map(g => g.players.length);
  const minPlayers = Math.min(...playerCounts);
  const maxPlayers = Math.max(...playerCounts);

  console.log(`[TOURNAMENT] Rebalancing complete. Player counts per table:`, playerCounts);
  console.log(`[TOURNAMENT] Min: ${minPlayers}, Max: ${maxPlayers}, Difference: ${maxPlayers - minPlayers}`);

  if (maxPlayers - minPlayers > 1) {
    console.warn(`[TOURNAMENT] WARNING: Tables are not balanced! Max difference is ${maxPlayers - minPlayers}`);
  }

  await auditChipConservation(tournamentId);

  try {
    const io = deps.getIO();
    await resyncGamesToMaxBlindLevel(tournamentId, io, { emitDealerMessage: false });
  } catch (e) {
    console.warn("[TOURNAMENT] Could not sync blind levels after rebalancing:", e?.message);
  }

  try {
    const io = deps.getIO();
    if (io) {
      // Allow hands to start again (startHandForGame refuses while this flag is set).
      _consolidationWaitTournamentIds.delete(tournamentId);
      let started = 0;
      for (const g of updatedGames) {
        if (g.players.length >= 2 && !(await deps.hasActiveHand(g.id))) {
          try {
            await deps.startHandForGame(g.id, io);
            started++;
            console.log(`[TOURNAMENT] Started hand for table ${g.tableNumber} after rebalancing (${g.players.length} players)`);
          } catch (err) {
            console.error(`[TOURNAMENT] Error starting hand for table ${g.tableNumber}:`, err?.message);
          }
        }
      }
      if (started > 0) {
        io.emit("consolidation-complete", { tournamentId });
      }
    }
  } catch (e) {
    console.warn("[TOURNAMENT] Could not start hands after rebalancing:", e?.message);
  }

  try {
    const io = deps.getIO();
    if (io) {
      for (const g of updatedGames) {
        io.to(`game:${g.id}`).emit("tournament_updated", { tournamentId });
      }
      io.emit("tournament_updated", { tournamentId });
    }
  } catch (e) {
    console.warn("[TOURNAMENT] Could not emit tournament_updated:", e?.message);
  }

  return updatedGames;
  } finally {
    _consolidationWaitTournamentIds.delete(tournamentId);
  }
}

/**
 * Public API: acquire lock, then wait for hands and run consolidation.
 * @param {string} tournamentId
 * @param {object} deps - hasActiveHand, getIO, forceStuckPlayerToAct, clearAllStateForGames, startHandForGame
 * @returns {Promise<object[]>} updated games
 */
export async function consolidateTables(tournamentId, deps) {
  const existing = _consolidationLocks.get(tournamentId);
  if (existing) {
    await existing;
    return consolidateTables(tournamentId, deps);
  }
  const p = doConsolidateTables(tournamentId, deps);
  _consolidationLocks.set(tournamentId, p);
  try {
    return await p;
  } finally {
    _consolidationLocks.delete(tournamentId);
  }
}
