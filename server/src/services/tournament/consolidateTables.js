import { prisma } from "../../config/database.js";
import { auditChipConservation } from "./chipAudit.js";
import { syncBlindLevelsToTournamentTime } from "./blindLevels.js";

const _consolidationLocks = new Map();

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
          break;
        }
        activeSince.delete(game.id);
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
    include: { players: true }
  });
  for (const g of games) {
    if (await deps.hasActiveHand(g.id)) {
      console.log(`[TOURNAMENT] Skipping consolidation: table ${g.tableNumber} (game ${g.id}) has active hand`);
      return games;
    }
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

  const totalCount = games.reduce((sum, g) => sum + (g.players?.length ?? 0), 0);
  const tablesNeeded = Math.max(1, Math.ceil(totalCount / seatsPerTable));
  const counts = games.map(g => g.players?.length ?? 0).filter(c => c > 0);
  const maxC = counts.length ? Math.max(...counts) : 0;
  const minC = counts.length ? Math.min(...counts) : 0;
  const spread = maxC - minC;

  const maxSpread = games.length > 6 ? 2 : 1;
  if (games.length <= tablesNeeded && spread <= maxSpread) {
    console.log(`[TOURNAMENT] Skipping consolidation: ${games.length} tables, counts ${counts.join(",")}, spread ${spread} (no rebalance needed)`);
    return games;
  }

  await new Promise((r) => setTimeout(r, 4000));

  const gamesToWait = games.map(g => ({ id: g.id }));
  if (gamesToWait.length > 0) {
    try {
      const io = deps.getIO();
      if (io) {
        for (const g of gamesToWait) {
          const hasHand = await deps.hasActiveHand(g.id);
          if (!hasHand) {
            io.to(`game:${g.id}`).emit("consolidation-waiting", {
              message: "Waiting for other tables to finish their hands before reseating...",
              tournamentId
            });
          }
        }
      }
    } catch (e) {
      console.warn("[TOURNAMENT] Could not emit consolidation-waiting:", e?.message);
    }
  }

  await waitForAllTablesToFinishHands(tournamentId, deps);

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

  if (totalPlayers === 0) {
    console.log(`[TOURNAMENT] No players remaining, skipping redistribution`);
    return games;
  }

  const numTables = games.length;
  const basePlayersPerTable = Math.floor(totalPlayers / numTables);
  const extraPlayers = totalPlayers % numTables;

  console.log(`[TOURNAMENT] Rebalancing ${totalPlayers} players across ${numTables} tables`);
  console.log(`[TOURNAMENT] Target: ${basePlayersPerTable}-${basePlayersPerTable + 1} players per table`);

  const shuffled = [...allPlayers].sort(() => Math.random() - 0.5);

  const tableAssignments = [];
  let playerIndex = 0;
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const targetPlayers = i < extraPlayers ? basePlayersPerTable + 1 : basePlayersPerTable;
    const playersForThisTable = shuffled.slice(playerIndex, playerIndex + targetPlayers);
    playerIndex += targetPlayers;

    tableAssignments.push({
      gameId: game.id,
      tableNumber: game.tableNumber,
      players: playersForThisTable
    });
  }

  for (const gameId of allActiveGameIdsForClear) {
    if (await deps.hasActiveHand(gameId)) {
      console.warn(`[TOURNAMENT] Aborting consolidation: game ${gameId} has active hand (started during wait)`);
      return games;
    }
  }

  try {
    deps.clearAllStateForGames(allActiveGameIdsForClear);
  } catch (e) {
    console.warn("[TOURNAMENT] Could not clear game state:", e?.message);
  }

  await prisma.$transaction(async (tx) => {
    for (const player of allPlayers) {
      await tx.player.delete({ where: { id: player.playerId } });
    }
    for (const assignment of tableAssignments) {
      await tx.player.deleteMany({ where: { gameId: assignment.gameId } });
    }
    for (const assignment of tableAssignments) {
      for (let seatIndex = 0; seatIndex < assignment.players.length; seatIndex++) {
        const { player } = assignment.players[seatIndex];
        if (!player?.userId) {
          throw new Error(`[TOURNAMENT] Invalid player in assignment table ${assignment.tableNumber} seat ${seatIndex + 1}`);
        }
        await tx.player.create({
          data: {
            gameId: assignment.gameId,
            userId: player.userId,
            seatNumber: seatIndex + 1,
            chips: player.chips,
            holeCards: "",
            status: "ACTIVE"
          }
        });
      }
    }
  });

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
    await syncBlindLevelsToTournamentTime(tournamentId, io, { emitDealerMessage: false });
  } catch (e) {
    console.warn("[TOURNAMENT] Could not sync blind levels after rebalancing:", e?.message);
  }

  try {
    const io = deps.getIO();
    if (io) {
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
