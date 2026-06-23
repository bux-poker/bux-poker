import { prisma } from "../../config/database.js";
import { auditChipConservation } from "./chipAudit.js";
import { resyncGamesToMaxBlindLevel } from "./blindLevels.js";
import { reconcileOrphanDbPotsForTournament } from "./stalePotRecovery.js";
import {
  analyzeTableBalance,
  countTournamentLivePlayers,
  minBalanceMovesSortedMatch,
  pickBalanceEndpoints,
  tournamentNeedsConsolidation,
} from "./tableBalanceTargets.js";
import {
  pickNextBigBlindMover,
  pickWorstOpenSeat,
} from "./balanceSeatSelection.js";

/**
 * Tell clients to refetch tournament + navigate if their gameId changed.
 * `doConsolidateTables` always invokes this from `finally` so early returns
 * (hand still up / DB pot abort) still notify clients.
 */
async function emitConsolidationResync(io, tournamentId) {
  if (!io) return;
  try {
    const activeGames = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      select: { id: true },
    });
    for (const ag of activeGames) {
      io.to(`game:${ag.id}`).emit("tournament_updated", { tournamentId });
    }
    io.emit("tournament_updated", { tournamentId });
    io.emit("consolidation-complete", { tournamentId });
    console.log(
      `[TOURNAMENT] consolidation-complete emitted (tournament ${tournamentId}, ${activeGames.length} active table room(s))`
    );
  } catch (e) {
    console.warn("[TOURNAMENT] consolidation resync emit failed:", e?.message);
  }
}

/** Still in the tournament (incl. 0-chip all-in). Excluding them broke table counts & closing tables. */
const NOT_ELIMINATED = { status: { not: "ELIMINATED" } };
/** Eligible to be moved / dealt in the next hand. Prevents reseating 0-chip all-ins. */
const MOVE_ELIGIBLE = { status: { not: "ELIMINATED" }, chips: { gt: 0 } };

async function assignPlayerToFirstAvailableGame(tx, playerId, gameIds, seatsPerTable) {
  for (const gid of gameIds) {
    const rows = await tx.player.findMany({
      where: { gameId: gid },
      select: { seatNumber: true },
    });
    if (rows.length >= seatsPerTable) continue;
    const taken = new Set(rows.map((r) => r.seatNumber));
    let s = 1;
    while (s <= seatsPerTable && taken.has(s)) s++;
    if (s > seatsPerTable) continue;
    await tx.player.update({
      where: { id: playerId },
      data: { gameId: gid, seatNumber: s },
    });
    return true;
  }
  return false;
}

/** Live players still seated on COMPLETED (or other non-ACTIVE) games — pull them back before rebalance. */
async function relocateStrandedLivePlayers(tournamentId, seatsPerTable) {
  const stranded = await prisma.player.findMany({
    where: {
      game: { tournamentId, status: { not: "ACTIVE" } },
      status: { not: "ELIMINATED" },
    },
    select: { id: true, gameId: true },
  });
  if (stranded.length === 0) return 0;

  let activeGames = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: { where: NOT_ELIMINATED, select: { id: true } },
    },
    orderBy: { tableNumber: "asc" },
  });

  if (activeGames.length === 0) {
    const reviveId = stranded[0].gameId;
    await prisma.game.update({
      where: { id: reviveId },
      data: { status: "ACTIVE", pot: 0 },
    });
    console.log(
      `[TOURNAMENT] Reactivated game ${reviveId} — no ACTIVE tables but ${stranded.length} stranded live player(s)`
    );
    activeGames = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: {
        players: { where: NOT_ELIMINATED, select: { id: true } },
      },
      orderBy: { tableNumber: "asc" },
    });
  }

  const gameIdsBySpace = [...activeGames]
    .sort(
      (a, b) =>
        seatsPerTable -
        (a.players?.length ?? 0) -
        (seatsPerTable - (b.players?.length ?? 0))
    )
    .map((g) => g.id);

  let moved = 0;
  await prisma.$transaction(async (tx) => {
    for (const p of stranded) {
      if (p.gameId && activeGames.some((g) => g.id === p.gameId)) continue;
      const placed = await assignPlayerToFirstAvailableGame(
        tx,
        p.id,
        gameIdsBySpace,
        seatsPerTable
      );
      if (placed) moved++;
      else {
        console.warn(
          `[TOURNAMENT] Could not relocate stranded player ${p.id} — no seat on ACTIVE tables`
        );
      }
    }
  });

  if (moved > 0) {
    console.log(
      `[TOURNAMENT] Relocated ${moved} stranded live player(s) onto ACTIVE tables`
    );
  }
  return moved;
}

async function createConsolidationGraveyardGame(tx, tournamentId) {
  const agg = await tx.game.aggregate({
    where: { tournamentId },
    _max: { tableNumber: true },
  });
  const tn = (agg._max.tableNumber ?? 0) + 1;
  return tx.game.create({
    data: {
      tournamentId,
      tableNumber: tn,
      status: "COMPLETED",
      pot: 0,
      communityCards: "",
    },
  });
}

/**
 * ELIMINATED rows still hold (gameId, seatNumber). The "keep" table can be 9/9 with only ~5 live
 * players — pickDest then throws "No free seat". Move eliminated off keep tables first.
 */
async function evacuateEliminatedFromKeepTables(
  tx,
  tournamentId,
  keepIds,
  closeGameIds,
  seatsPerTable
) {
  const graveyards = [];
  let total = 0;
  for (const keepId of keepIds) {
    const eliminated = await tx.player.findMany({
      where: { gameId: keepId, status: "ELIMINATED" },
      select: { id: true },
    });
    for (const e of eliminated) {
      let placed = await assignPlayerToFirstAvailableGame(
        tx,
        e.id,
        closeGameIds,
        seatsPerTable
      );
      if (!placed) {
        for (const gy of graveyards) {
          placed = await assignPlayerToFirstAvailableGame(tx, e.id, [gy.id], seatsPerTable);
          if (placed) break;
        }
      }
      while (!placed) {
        const gy = await createConsolidationGraveyardGame(tx, tournamentId);
        graveyards.push(gy);
        placed = await assignPlayerToFirstAvailableGame(tx, e.id, [gy.id], seatsPerTable);
      }
      total++;
    }
  }
  if (total > 0) {
    console.log(
      `[TOURNAMENT] Pre-merge: moved ${total} eliminated row(s) off keep table(s) to free physical seats (close/graveyard)`
    );
  }
}

/**
 * ELIMINATED rows still hold seats. A table can be 9/9 DB rows with only ~5 live players, so spread
 * balance throws "Table full". Park eliminated on a COMPLETED graveyard until there is a free seat.
 */
async function relocateEliminatedOffTableToGraveyard(
  tx,
  tournamentId,
  sourceGameId,
  seatsPerTable
) {
  const graveyards = [];
  let moved = 0;
  while (true) {
    const totalRows = await tx.player.count({ where: { gameId: sourceGameId } });
    if (totalRows < seatsPerTable) break;
    const nextElim = await tx.player.findFirst({
      where: { gameId: sourceGameId, status: "ELIMINATED" },
      select: { id: true },
    });
    if (!nextElim) break;
    let placed = false;
    for (const gy of graveyards) {
      placed = await assignPlayerToFirstAvailableGame(
        tx,
        nextElim.id,
        [gy.id],
        seatsPerTable
      );
      if (placed) break;
    }
    while (!placed) {
      const gy = await createConsolidationGraveyardGame(tx, tournamentId);
      graveyards.push(gy);
      placed = await assignPlayerToFirstAvailableGame(
        tx,
        nextElim.id,
        [gy.id],
        seatsPerTable
      );
    }
    moved++;
  }
  if (moved > 0) {
    console.log(
      `[TOURNAMENT] Balance prep: moved ${moved} eliminated row(s) off table (game ${sourceGameId}) to graveyard`
    );
  }
}

const _consolidationLocks = new Map();

/** tournamentId -> Set<gameId> — only these games are blocked from starting new hands during that wave. */
const _consolidationWaitByTournament = new Map();
const _consolidationWaitGameIds = new Set();

function registerConsolidationWait(tournamentId, gameIds) {
  let s = _consolidationWaitByTournament.get(tournamentId);
  if (!s) {
    s = new Set();
    _consolidationWaitByTournament.set(tournamentId, s);
  }
  for (const gid of gameIds) {
    if (!gid) continue;
    s.add(gid);
    _consolidationWaitGameIds.add(gid);
  }
}

function unregisterConsolidationWait(tournamentId, gameIds) {
  const s = _consolidationWaitByTournament.get(tournamentId);
  if (!s) return;
  for (const gid of gameIds) {
    if (!gid) continue;
    s.delete(gid);
    _consolidationWaitGameIds.delete(gid);
  }
  if (s.size === 0) {
    _consolidationWaitByTournament.delete(tournamentId);
  }
}

function clearConsolidationWaitTournament(tournamentId) {
  const s = _consolidationWaitByTournament.get(tournamentId);
  if (!s) return;
  for (const gid of s) {
    _consolidationWaitGameIds.delete(gid);
  }
  _consolidationWaitByTournament.delete(tournamentId);
}

/** True if this table must not start a new hand during an active consolidation wave. */
export function isGameConsolidationWaiting(gameId) {
  return _consolidationWaitGameIds.has(gameId);
}

/** True while any table in the tournament is in a consolidation wait slice (for logging / coarse checks). */
export function isTournamentConsolidationWaiting(tournamentId) {
  const s = _consolidationWaitByTournament.get(tournamentId);
  return !!s && s.size > 0;
}

/**
 * How many tables share this consolidation-wait slice (1 = only this table; 2+ = balance merge).
 * Used for accurate dealer / UI copy.
 */
export function getConsolidationWaitPeersCount(gameId) {
  if (!gameId) return 0;
  for (const s of _consolidationWaitByTournament.values()) {
    if (s.has(gameId)) return s.size;
  }
  return 0;
}

const CONSOLIDATION_WAIT_MSG_SINGLE =
  "Finish this hand before players are moved for tournament reseating.";
const CONSOLIDATION_WAIT_MSG_MULTI =
  "Table balance: waiting for other table(s) in this merge to finish their hands — yours may already be done. Please wait.";

export function consolidationWaitMessageForGame(gameId) {
  const n = getConsolidationWaitPeersCount(gameId);
  return n <= 1 ? CONSOLIDATION_WAIT_MSG_SINGLE : CONSOLIDATION_WAIT_MSG_MULTI;
}

/** Upper cap per consolidation run (avoid huge tx bursts); below we use estimated need. */
const MAX_BALANCE_MOVES_CAP = 24;

async function emitRoomsGameState(gameIds, io) {
  if (!io) return;
  const { emitGameState } = await import("../../modules/poker/emitGameState.js");
  const { tableState } = await import("../../modules/poker/tableState.js");
  for (const gid of [...new Set(gameIds)].filter(Boolean)) {
    try {
      await emitGameState(gid, io, tableState.get(gid) ?? null);
    } catch (e) {
      console.warn(`[TOURNAMENT] emit game-state ${gid}:`, e?.message);
    }
  }
}

/**
 * Wait until listed games have no active hand. If a hand is stuck 90s+, force current player to act.
 * Does not nuke in-memory state (that could strand chips vs DB).
 * @param {string[]} gameIds
 * @param {{ hasActiveHand: (gameId: string) => Promise<boolean>, forceStuckPlayerToAct: (gameId: string, io: object) => Promise<boolean>, getIO: () => object, getTableNumber?: (gameId: string) => Promise<number|undefined>, clearAllStateForGames?: (gameIds: string[]) => void }} deps
 */
export function waitForGameIdsToFinishHands(gameIds, deps) {
  const ids = [...new Set(gameIds)].filter(Boolean);
  if (ids.length === 0) {
    return Promise.resolve(true);
  }

  const checkInterval = 2000;
  const stuckThresholdMs = 90000;
  /** Do not hammer force every 2s once stuck — applyPlayerAction may succeed without finishing the hand. */
  const forceThrottleMs = 30000;
  const activeSince = new Map();
  const lastForceAttempt = new Map();

  return new Promise((resolve) => {
    const checkHands = async () => {
      let allHandsFinished = true;
      for (const gameId of ids) {
        const hasHand = await deps.hasActiveHand(gameId);
        if (hasHand) {
          const now = Date.now();
          if (!activeSince.has(gameId)) activeSince.set(gameId, now);
          const stuckForMs = now - activeSince.get(gameId);
          const waitingFor = stuckForMs / 1000;
          allHandsFinished = false;

          let tableLabel = gameId.slice(0, 8);
          if (deps.getTableNumber) {
            try {
              const tn = await deps.getTableNumber(gameId);
              if (tn != null) tableLabel = `table ${tn}`;
            } catch {
              /* ignore */
            }
          }

          if (stuckForMs >= stuckThresholdMs) {
            const lastForce = lastForceAttempt.get(gameId) ?? 0;
            if (now - lastForce >= forceThrottleMs) {
              lastForceAttempt.set(gameId, now);
              try {
                const io = deps.getIO();
                const ok = await deps.forceStuckPlayerToAct(gameId, io);
                if (ok) {
                  console.log(
                    `[TOURNAMENT] ${tableLabel} hand stuck ${waitingFor.toFixed(0)}s - forced player to act`
                  );
                }
              } catch (e) {
                console.warn(`[TOURNAMENT] Force-stuck failed for ${tableLabel}:`, e?.message);
              }
            }
          } else {
            console.log(
              `[TOURNAMENT] ${tableLabel} still has active hand, waiting... (${waitingFor.toFixed(0)}s)`
            );
          }
        } else {
          activeSince.delete(gameId);
          lastForceAttempt.delete(gameId);
        }
      }

      if (allHandsFinished) {
        console.log(
          `[TOURNAMENT] Listed tables (${ids.length}) finished their hands, proceeding with this consolidation step`
        );
        resolve(true);
        return;
      }

      setTimeout(checkHands, checkInterval);
    };

    checkHands();
  });
}

async function emitConsolidationWaitToGames(gameIds, tournamentId, io) {
  if (!io) return;
  const { emitGameState } = await import("../../modules/poker/emitGameState.js");
  const { tableState } = await import("../../modules/poker/tableState.js");
  const ids = [...new Set(gameIds)].filter(Boolean);
  const waitMessage =
    ids.length <= 1 ? CONSOLIDATION_WAIT_MSG_SINGLE : CONSOLIDATION_WAIT_MSG_MULTI;
  for (const gid of ids) {
    io.to(`game:${gid}`).emit("consolidation-waiting", {
      message: waitMessage,
      tournamentId,
    });
    try {
      const st = tableState.get(gid);
      await emitGameState(gid, io, st ?? null);
    } catch (e) {
      console.warn(`[TOURNAMENT] Could not emit game-state during consolidation wait (${gid}):`, e?.message);
    }
  }
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

  const handBlocksConsolidation =
    deps.hasConsolidationBlockingHand ?? deps.hasActiveHand;

  await relocateStrandedLivePlayers(tournamentId, seatsPerTable);

  let games = await prisma.game.findMany({
    where: { tournamentId, status: "ACTIVE" },
    include: {
      players: {
        where: NOT_ELIMINATED,
        include: { user: true }
      }
    },
    orderBy: { tableNumber: "asc" }
  });

  const totalCount = games.reduce((sum, g) => sum + (g.players?.length ?? 0), 0);
  const tournamentLiveTotal = await countTournamentLivePlayers(tournamentId);
  const balPreview = analyzeTableBalance(games, seatsPerTable);
  if (!tournamentNeedsConsolidation(games, seatsPerTable, tournamentLiveTotal)) {
    console.log(
      `[TOURNAMENT] Skipping consolidation: canonical table balance OK (${totalCount} players, ${games.length} ACTIVE game(s), seatsPerTable=${seatsPerTable}, target [${balPreview.targets.join(",")}])`
    );
    return games;
  }

  const waitDeps = {
    hasActiveHand: handBlocksConsolidation,
    forceStuckPlayerToAct: deps.forceStuckPlayerToAct,
    getIO: deps.getIO,
    clearAllStateForGames: deps.clearAllStateForGames,
    getTableNumber: async (gameId) => {
      const row = await prisma.game.findUnique({
        where: { id: gameId },
        select: { tableNumber: true },
      });
      return row?.tableNumber;
    },
  };

  try {
    await reconcileOrphanDbPotsForTournament(tournamentId);

    // Close one excess table per wave; only the closing table waits for its hand (destinations keep playing).
    while (true) {
      games = await prisma.game.findMany({
        where: { tournamentId, status: "ACTIVE" },
        include: {
          players: {
            where: NOT_ELIMINATED,
            include: { user: true },
          },
        },
        orderBy: { tableNumber: "asc" },
      });

      const totalLive = games.reduce((s, g) => s + (g.players?.length ?? 0), 0);
      if (totalLive === 0) {
        console.log(`[TOURNAMENT] No players remaining during consolidation`);
        return games;
      }

      const numTablesNeeded = Math.max(1, Math.ceil(totalLive / seatsPerTable));
      if (games.length <= numTablesNeeded) {
        break;
      }

      if (totalLive > numTablesNeeded * seatsPerTable) {
        console.error(
          `[TOURNAMENT] Cannot consolidate: ${totalLive} players exceed capacity (${numTablesNeeded}×${seatsPerTable} seats)`
        );
        return games;
      }

      const byPlayerCount = [...games].sort(
        (a, b) => (a.players?.length ?? 0) - (b.players?.length ?? 0)
      );
      const toClose = byPlayerCount.slice(0, byPlayerCount.length - numTablesNeeded);
      const toKeep = byPlayerCount.slice(-numTablesNeeded);
      const closeG = toClose[0];
      const keepIds = toKeep.map((g) => g.id);
      const closeIds = toClose.map((g) => g.id);

      await prisma.$transaction(async (tx) => {
        await evacuateEliminatedFromKeepTables(
          tx,
          tournamentId,
          keepIds,
          closeIds,
          seatsPerTable
        );
      });

      const closeExists = await prisma.game.findUnique({
        where: { id: closeG.id },
        select: { id: true, tableNumber: true },
      });
      if (!closeExists) {
        console.warn("[TOURNAMENT] Close target game missing; aborting consolidation wave");
        return games;
      }

      const waitCloseIds = [closeG.id];
      const touchedDestIds = [];
      registerConsolidationWait(tournamentId, waitCloseIds);
      try {
        const io = deps.getIO();
        if (await handBlocksConsolidation(closeG.id)) {
          console.log(
            `[TOURNAMENT] Merge: wait only closing table ${closeG.tableNumber} — destination tables keep playing`
          );
          if (io) await emitConsolidationWaitToGames(waitCloseIds, tournamentId, io);
          await waitForGameIdsToFinishHands(waitCloseIds, waitDeps);
        }
        await new Promise((r) => setTimeout(r, 2000));

        if (await handBlocksConsolidation(closeG.id)) {
          console.log(
            `[TOURNAMENT] Consolidation aborted: closing table still in hand; will retry next poll`
          );
          return games;
        }

        const preClosePot = await prisma.game.findUnique({
          where: { id: closeG.id },
          select: { pot: true, tableNumber: true },
        });
        if ((preClosePot?.pot ?? 0) > 0) {
          console.warn(
            `[TOURNAMENT] Consolidation aborted: closing table ${closeG.tableNumber} DB pot ${preClosePot.pot}`
          );
          return games;
        }

        await prisma.$transaction(async (tx) => {
          const destSnapshots = await tx.game.findMany({
            where: { id: { in: keepIds } },
            include: {
              players: {
                select: {
                  id: true,
                  seatNumber: true,
                  chips: true,
                  userId: true,
                  status: true,
                },
              },
            },
            orderBy: { tableNumber: "asc" },
          });

          const destState = destSnapshots.map((g) => ({
            id: g.id,
            tableNumber: g.tableNumber,
            bigBlindSeat: g.bigBlindSeat,
            smallBlindSeat: g.smallBlindSeat,
            rows: [...g.players],
          }));

          const liveCount = (d) =>
            d.rows.filter((p) => p.status !== "ELIMINATED").length;

          const pickDest = () => {
            const viable = destState.filter((d) => d.rows.length < seatsPerTable);
            if (viable.length === 0) {
              throw new Error(`[TOURNAMENT] No free seat (seatsPerTable=${seatsPerTable})`);
            }
            viable.sort((a, b) => liveCount(a) - liveCount(b));
            return viable[0];
          };

          const worstSeatOnDestination = (d) => {
            const taken = new Set(d.rows.map((p) => p.seatNumber));
            const seat = pickWorstOpenSeat(
              taken,
              seatsPerTable,
              d.bigBlindSeat,
              d.smallBlindSeat
            );
            if (seat == null) {
              throw new Error(`[TOURNAMENT] No seat on table ${d.tableNumber}`);
            }
            return seat;
          };

          const movers = await tx.player.findMany({
            where: { gameId: closeG.id, ...MOVE_ELIGIBLE },
          });
          const allOnCloseBeforeMoves = await tx.player.findMany({
            where: { gameId: closeG.id },
            select: {
              id: true,
              userId: true,
              seatNumber: true,
              chips: true,
              status: true,
            },
          });
          const closeRow = await tx.game.findUnique({
            where: { id: closeG.id },
            select: { pot: true, tableNumber: true },
          });
          const orphanPot = closeRow?.pot ?? 0;
          let orphanRemaining = orphanPot;

          if (orphanRemaining > 0 && movers.length > 0) {
            const first = [...movers].sort(
              (a, b) => a.seatNumber - b.seatNumber
            )[0];
            const newChips = (first.chips ?? 0) + orphanRemaining;
            await tx.player.update({
              where: { id: first.id },
              data: { chips: newChips },
            });
            first.chips = newChips;
            console.log(
              `[TOURNAMENT] Orphan pot ${orphanPot} from table ${closeG.tableNumber} → first mover ${first.id}`
            );
            orphanRemaining = 0;
          } else if (orphanRemaining > 0) {
            const live = allOnCloseBeforeMoves.find(
              (r) => r.status !== "ELIMINATED"
            );
            if (live) {
              const nc = (live.chips ?? 0) + orphanRemaining;
              await tx.player.update({
                where: { id: live.id },
                data: { chips: nc },
              });
              live.chips = nc;
              console.log(
                `[TOURNAMENT] Orphan pot ${orphanPot} from table ${closeG.tableNumber} → player ${live.id} (only non-eliminated row on closing table)`
              );
              orphanRemaining = 0;
            }
          }

          if (orphanRemaining > 0) {
            throw new Error(
              `[TOURNAMENT] Refusing to close table ${closeG.tableNumber} (${closeG.id}): cannot credit orphan DB pot=${orphanRemaining} to any non-eliminated player`
            );
          }

          for (let i = movers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [movers[i], movers[j]] = [movers[j], movers[i]];
          }

          for (const p of movers) {
            const dst = pickDest();
            const seat = worstSeatOnDestination(dst);
            touchedDestIds.push(dst.id);
            await tx.player.update({
              where: { id: p.id },
              data: { gameId: dst.id, seatNumber: seat },
            });
            dst.rows.push({
              id: p.id,
              seatNumber: seat,
              chips: p.chips,
              userId: p.userId,
              status: p.status ?? "ACTIVE",
            });
            console.log(
              `[TOURNAMENT] Consolidation move (worst seat / TDA): user ${p.userId} table ${closeG.tableNumber} → table ${dst.tableNumber} seat ${seat}`
            );
          }

          // MOVE_ELIGIBLE-only movers left 0-chip live rows and ELIMINATED rows on the closing game.
          // Closing it without relocating them orphans DB rows on a COMPLETED table (ghost seats / missing at showdown).
          const graveyardsForClose = [];
          const leftovers = await tx.player.findMany({
            where: { gameId: closeG.id },
            select: {
              id: true,
              userId: true,
              seatNumber: true,
              chips: true,
              status: true,
            },
          });

          for (const p of leftovers) {
            if (p.status === "ELIMINATED") {
              let placed = false;
              for (const gy of graveyardsForClose) {
                placed = await assignPlayerToFirstAvailableGame(
                  tx,
                  p.id,
                  [gy.id],
                  seatsPerTable
                );
                if (placed) break;
              }
              while (!placed) {
                const gy = await createConsolidationGraveyardGame(tx, tournamentId);
                graveyardsForClose.push(gy);
                placed = await assignPlayerToFirstAvailableGame(
                  tx,
                  p.id,
                  [gy.id],
                  seatsPerTable
                );
              }
              console.log(
                `[TOURNAMENT] Pre-close: moved eliminated row ${p.id} off closing table ${closeG.tableNumber} to graveyard`
              );
            } else {
              const dst = pickDest();
              const seat = worstSeatOnDestination(dst);
              touchedDestIds.push(dst.id);
              await tx.player.update({
                where: { id: p.id },
                data: { gameId: dst.id, seatNumber: seat },
              });
              dst.rows.push({
                id: p.id,
                seatNumber: seat,
                chips: p.chips,
                userId: p.userId,
                status: p.status ?? "ACTIVE",
              });
              console.log(
                `[TOURNAMENT] Pre-close: moved leftover live row user ${p.userId} (${p.status}, chips=${p.chips}) off table ${closeG.tableNumber} → table ${dst.tableNumber} seat ${seat}`
              );
            }
          }

          const stillOnClose = await tx.player.count({
            where: { gameId: closeG.id },
          });
          if (stillOnClose > 0) {
            throw new Error(
              `[TOURNAMENT] Invariant failed: ${stillOnClose} player row(s) still on closing game ${closeG.id}`
            );
          }

          await tx.game.update({
            where: { id: closeG.id },
            data: { status: "COMPLETED", pot: 0 },
          });
          console.log(
            `[TOURNAMENT] Closed game ${closeG.id} (table ${closeG.tableNumber}) after migrating ${movers.length} chip-positive mover(s) + ${leftovers.length} leftover row(s)`
          );
        });

        // Table is COMPLETED — drop wait flag immediately so any emit shows no "wait for hand" on this URL.
        unregisterConsolidationWait(tournamentId, waitCloseIds);

        try {
          deps.clearAllStateForGames([closeG.id]);
          const uniqueDest = [...new Set(touchedDestIds)];
          for (const did of uniqueDest) {
            if (await deps.hasActiveHand(did)) continue;
            const potCheck = await prisma.game.findUnique({
              where: { id: did },
              select: { pot: true, tableNumber: true },
            });
            if ((potCheck?.pot ?? 0) > 0) {
              console.warn(
                `[TOURNAMENT] Skip clearAllState for destination game ${did} (table ${potCheck?.tableNumber}) — DB pot ${potCheck.pot} (avoid mid-hand wipe)`
              );
              continue;
            }
            deps.clearAllStateForGames([did]);
          }
        } catch (e) {
          console.warn("[TOURNAMENT] Could not clear game state:", e?.message);
        }
      } finally {
        unregisterConsolidationWait(tournamentId, waitCloseIds);
      }

      const ioWave = deps.getIO();
      if (ioWave) {
        await emitRoomsGameState([...new Set(touchedDestIds)], ioWave);
        for (const gid of [...new Set(touchedDestIds)]) {
          const g = await prisma.game.findUnique({
            where: { id: gid },
            include: { players: { where: MOVE_ELIGIBLE } },
          });
          if (
            g &&
            g.players.length >= 2 &&
            !(await deps.hasActiveHand(gid))
          ) {
            try {
              await deps.startHandForGame(gid, ioWave);
            } catch (err) {
              console.error(
                `[TOURNAMENT] Error starting hand after close wave:`,
                err?.message
              );
            }
          }
        }
      }
    }

    let bgames = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: {
        players: {
          where: NOT_ELIMINATED,
          include: { user: true },
          orderBy: { seatNumber: "asc" },
        },
      },
      orderBy: { tableNumber: "asc" },
    });

    const totalPlayersLive = bgames.reduce(
      (s, g) => s + (g.players?.length ?? 0),
      0
    );
    if (totalPlayersLive === 0) {
      console.log(`[TOURNAMENT] No players remaining, skipping redistribution`);
      return bgames;
    }

    let balLive = analyzeTableBalance(bgames, seatsPerTable);
    console.log(
      `[TOURNAMENT] Live counts: ${bgames
        .map((g) => `${g.tableNumber}:${g.players?.length ?? 0}`)
        .join(", ")} — canonical [${balLive.targets.join(",")}] (T=${balLive.T})`
    );

    // If nonempty table count > canonical T (e.g. 63 players still on 8 shells after a bust), the
    // close-table wave above moves all chip-positive players off the closing table in one txn — not
    // this per-player loop. Here we only fix wrong multisets when nonempty.length already equals T.

    if (!balLive.distributionOk && balLive.nonempty.length === balLive.T) {
      const sortedCounts = balLive.nonempty
        .map((g) => g.players.length)
        .sort((a, b) => a - b);
      const targetSorted = [...balLive.targets].sort((a, b) => a - b);
      const movesNeeded = minBalanceMovesSortedMatch(sortedCounts, targetSorted);
      const maxBalanceMovesThisRun = Math.min(
        MAX_BALANCE_MOVES_CAP,
        Math.max(1, movesNeeded)
      );
      console.log(
        `[TOURNAMENT] Balance plan: ~${movesNeeded} player move(s) to canonical; will run up to ${maxBalanceMovesThisRun} this pass`
      );

      let balanceMoves = 0;
      while (balanceMoves < maxBalanceMovesThisRun) {
        bgames = await prisma.game.findMany({
          where: { tournamentId, status: "ACTIVE" },
          include: {
            players: {
              where: NOT_ELIMINATED,
              include: { user: true },
              orderBy: { seatNumber: "asc" },
            },
          },
          orderBy: { tableNumber: "asc" },
        });

        const pairPreWait = pickBalanceEndpoints(bgames, seatsPerTable);
        if (!pairPreWait) break;
        const { srcGame, dstGame } = pairPreWait;

        const waitBalanceIds = [srcGame.id, dstGame.id];
        registerConsolidationWait(tournamentId, waitBalanceIds);
        let progressed = false;
        try {
          const io = deps.getIO();
          const srcHand = await handBlocksConsolidation(srcGame.id);
          const dstHand = await handBlocksConsolidation(dstGame.id);
          if (srcHand || dstHand) {
            console.log(
              `[TOURNAMENT] Balance: waiting for hands to finish on tables ${srcGame.tableNumber} (largest) and ${dstGame.tableNumber} (smallest) before moving one seated player`
            );
            if (io)
              await emitConsolidationWaitToGames(waitBalanceIds, tournamentId, io);
            await waitForGameIdsToFinishHands(waitBalanceIds, waitDeps);
          }
          await new Promise((r) => setTimeout(r, 1500));

          if (
            (await handBlocksConsolidation(srcGame.id)) ||
            (await handBlocksConsolidation(dstGame.id))
          ) {
            console.log(
              `[TOURNAMENT] Balance: a source/destination table still in hand — stop for this run`
            );
            break;
          }

          // Hands can change chip counts / eligibility; re-pick endpoints after wait (avoids "missing src/dst").
          bgames = await prisma.game.findMany({
            where: { tournamentId, status: "ACTIVE" },
            include: {
              players: {
                where: NOT_ELIMINATED,
                include: { user: true },
                orderBy: { seatNumber: "asc" },
              },
            },
            orderBy: { tableNumber: "asc" },
          });
          const pairPostWait = pickBalanceEndpoints(bgames, seatsPerTable);
          if (!pairPostWait) break;
          const srcGameTx = pairPostWait.srcGame;
          const dstGameTx = pairPostWait.dstGame;

          if (
            (await handBlocksConsolidation(srcGameTx.id)) ||
            (await handBlocksConsolidation(dstGameTx.id))
          ) {
            console.log(
              `[TOURNAMENT] Balance: source or destination still in hand (post-refresh) — stop for this run`
            );
            break;
          }

          const srcPotRow = await prisma.game.findUnique({
            where: { id: srcGameTx.id },
            select: { pot: true, tableNumber: true },
          });
          if ((srcPotRow?.pot ?? 0) > 0) {
            console.warn(
              `[TOURNAMENT] Balance: source table ${srcGameTx.tableNumber} DB pot ${srcPotRow.pot} — skip`
            );
            break;
          }

          let balanceTxnSkipped = false;
          await prisma.$transaction(async (tx) => {
            const gs = await tx.game.findMany({
              where: { tournamentId, status: "ACTIVE" },
              include: {
                players: {
                  where: MOVE_ELIGIBLE,
                  orderBy: { seatNumber: "asc" },
                },
              },
              orderBy: { tableNumber: "asc" },
            });
            const srcRow = gs.find((g) => g.id === srcGameTx.id);
            const dstRow = gs.find((g) => g.id === dstGameTx.id);
            if (!srcRow?.players?.length || !dstRow) {
              console.warn(
                "[TOURNAMENT] Balance: missing src/dst or no chip-positive movers in transaction — stale snapshot, will retry next poll"
              );
              balanceTxnSkipped = true;
              return;
            }

            await relocateEliminatedOffTableToGraveyard(
              tx,
              tournamentId,
              dstRow.id,
              seatsPerTable
            );

            const dstAllSeats = await tx.player.findMany({
              where: { gameId: dstRow.id },
              select: { seatNumber: true },
            });
            if (dstAllSeats.length >= seatsPerTable) {
              console.warn(
                `[TOURNAMENT] Balance: destination table ${dstRow.tableNumber} full (${dstAllSeats.length}/${seatsPerTable}) after graveyard pass — retry next poll`
              );
              balanceTxnSkipped = true;
              return;
            }
            const taken = new Set(dstAllSeats.map((p) => p.seatNumber));
            const seat = pickWorstOpenSeat(
              taken,
              seatsPerTable,
              dstRow.bigBlindSeat,
              dstRow.smallBlindSeat
            );
            if (seat == null) {
              console.warn(
                `[TOURNAMENT] Balance: no free seat on table ${dstRow.tableNumber} (TDA layout) — retry next poll`
              );
              balanceTxnSkipped = true;
              return;
            }

            const mover = pickNextBigBlindMover(
              srcRow.players,
              srcRow.bigBlindSeat,
              seatsPerTable
            );
            if (!mover) {
              console.warn(
                "[TOURNAMENT] Balance: could not pick mover — retry next poll"
              );
              balanceTxnSkipped = true;
              return;
            }
            await tx.player.update({
              where: { id: mover.id },
              data: { gameId: dstRow.id, seatNumber: seat },
            });
            console.log(
              `[TOURNAMENT] Balance: moved next-BB / UTG user ${mover.userId} table ${srcRow.tableNumber} → ${dstRow.tableNumber} worst seat ${seat} (TDA)`
            );
          });

          if (balanceTxnSkipped) break;

          try {
            deps.clearAllStateForGames([srcGameTx.id]);
            if (!(await deps.hasActiveHand(dstGameTx.id))) {
              const potDst = await prisma.game.findUnique({
                where: { id: dstGameTx.id },
                select: { pot: true },
              });
              if ((potDst?.pot ?? 0) === 0) {
                deps.clearAllStateForGames([dstGameTx.id]);
              } else {
                console.warn(
                  `[TOURNAMENT] Skip clearAllState for balance destination ${dstGameTx.id} — DB pot ${potDst.pot}`
                );
              }
            }
          } catch (e) {
            console.warn("[TOURNAMENT] Balance clear state:", e?.message);
          }

          const ioPush = deps.getIO();
          if (ioPush) {
            await emitRoomsGameState([srcGameTx.id, dstGameTx.id], ioPush);
            for (const gid of [srcGameTx.id, dstGameTx.id]) {
              const g = await prisma.game.findUnique({
                where: { id: gid },
                include: { players: { where: MOVE_ELIGIBLE } },
              });
              if (
                g &&
                g.players.length >= 2 &&
                !(await deps.hasActiveHand(gid))
              ) {
                try {
                  await deps.startHandForGame(gid, ioPush);
                } catch (err) {
                  console.error(
                    `[TOURNAMENT] Balance post-move start:`,
                    err?.message
                  );
                }
              }
            }
          }

          progressed = true;
          balanceMoves++;
        } finally {
          unregisterConsolidationWait(tournamentId, waitBalanceIds);
        }

        if (!progressed) break;
      }
    } else if (!balLive.distributionOk) {
      console.log(
        `[TOURNAMENT] Balance deferred: seated table count ${balLive.nonempty.length} !== canonical T ${balLive.T} (close-table wave should run first)`
      );
    } else {
      console.log(
        `[TOURNAMENT] Seated counts match canonical distribution — no balance moves this run`
      );
    }

    const updatedGames = await prisma.game.findMany({
      where: { tournamentId, status: "ACTIVE" },
      include: {
        players: {
          where: NOT_ELIMINATED,
        },
      },
    });

    const endBal = analyzeTableBalance(updatedGames, seatsPerTable);
    const seatedCounts = updatedGames.map((g) => g.players.length);

    console.log(
      `[TOURNAMENT] Rebalancing complete. Seated (non-eliminated) per table:`,
      seatedCounts
    );
    console.log(
      `[TOURNAMENT] Canonical target [${endBal.targets.join(",")}] — distributionOk=${endBal.distributionOk}`
    );

    if (!endBal.distributionOk) {
      console.warn(
        `[TOURNAMENT] WARNING: Seated counts still differ from canonical distribution`
      );
    }

    await auditChipConservation(tournamentId);

    try {
      const io = deps.getIO();
      await resyncGamesToMaxBlindLevel(tournamentId, io, {
        emitDealerMessage: false,
      });
    } catch (e) {
      console.warn(
        "[TOURNAMENT] Could not sync blind levels after rebalancing:",
        e?.message
      );
    }

    try {
      const io = deps.getIO();
      if (io && endBal.distributionOk && !endBal.needCloseEmptyShells) {
        const chipPositiveGames = await prisma.game.findMany({
          where: { tournamentId, status: "ACTIVE" },
          include: {
            players: {
              where: MOVE_ELIGIBLE,
            },
          },
        });
        for (const g of chipPositiveGames) {
          if (
            g.players.length >= 2 &&
            !(await deps.hasActiveHand(g.id))
          ) {
            try {
              await deps.startHandForGame(g.id, io);
              console.log(
                `[TOURNAMENT] Started hand for table ${g.tableNumber} after rebalancing (${g.players.length} chip-positive players)`
              );
            } catch (err) {
              console.error(
                `[TOURNAMENT] Error starting hand for table ${g.tableNumber}:`,
                err?.message
              );
            }
          }
        }
      }
    } catch (e) {
      console.warn(
        "[TOURNAMENT] Could not start hands after rebalancing:",
        e?.message
      );
    }

    return updatedGames;
  } finally {
    try {
      const ioFinal = deps.getIO();
      if (ioFinal) await emitConsolidationResync(ioFinal, tournamentId);
    } catch (e) {
      console.warn("[TOURNAMENT] consolidation resync (finally):", e?.message);
    }
    clearConsolidationWaitTournament(tournamentId);
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
