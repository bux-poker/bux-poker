import { prisma } from "../../config/database.js";
import { auditChipConservation } from "./chipAudit.js";
import { resyncGamesToMaxBlindLevel } from "./blindLevels.js";

/** Still in the tournament (incl. 0-chip all-in). Excluding them broke table counts & closing tables. */
const NOT_ELIMINATED = { status: { not: "ELIMINATED" } };

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

/** Max one-table-to-table moves per consolidation run (idle poll calls this ~15s). */
const MAX_BALANCE_MOVES_PER_RUN = 12;

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
 * @param {string[]} gameIds
 * @param {{ hasActiveHand: (gameId: string) => Promise<boolean>, forceStuckPlayerToAct: (gameId: string, io: object) => Promise<boolean>, getIO: () => object, getTableNumber?: (gameId: string) => Promise<number|undefined> }} deps
 */
export function waitForGameIdsToFinishHands(gameIds, deps) {
  const ids = [...new Set(gameIds)].filter(Boolean);
  if (ids.length === 0) {
    return Promise.resolve(true);
  }

  const checkInterval = 2000;
  const stuckThresholdMs = 90000;
  const activeSince = new Map();

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
            try {
              const io = deps.getIO();
              const ok = await deps.forceStuckPlayerToAct(gameId, io);
              if (ok) {
                console.log(
                  `[TOURNAMENT] ${tableLabel} hand stuck ${waitingFor.toFixed(0)}s - forced player to act`
                );
                activeSince.delete(gameId);
              }
            } catch (e) {
              console.warn(`[TOURNAMENT] Force-stuck failed for ${tableLabel}:`, e?.message);
            }
          } else {
            console.log(
              `[TOURNAMENT] ${tableLabel} still has active hand, waiting... (${waitingFor.toFixed(0)}s)`
            );
          }
        } else {
          activeSince.delete(gameId);
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
  for (const gid of gameIds) {
    io.to(`game:${gid}`).emit("consolidation-waiting", {
      message: "Waiting for this table's hand to finish before reseating...",
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
  const tablesNeeded = Math.max(1, Math.ceil(totalCount / seatsPerTable));
  const counts = games.map(g => g.players?.length ?? 0).filter(c => c > 0);
  const maxC = counts.length ? Math.max(...counts) : 0;
  const minC = counts.length ? Math.min(...counts) : 0;
  const spread = maxC - minC;

  const maxSpread = 1;
  if (games.length <= tablesNeeded && spread <= maxSpread) {
    console.log(
      `[TOURNAMENT] Skipping consolidation: ${games.length} ACTIVE game(s) ≤ tablesNeeded=${tablesNeeded} (${totalCount} players, seatsPerTable=${seatsPerTable}), counts [${counts.join(",")}], spread ${spread}`
    );
    return games;
  }

  const waitDeps = {
    hasActiveHand: deps.hasActiveHand,
    forceStuckPlayerToAct: deps.forceStuckPlayerToAct,
    getIO: deps.getIO,
    getTableNumber: async (gameId) => {
      const row = await prisma.game.findUnique({
        where: { id: gameId },
        select: { tableNumber: true },
      });
      return row?.tableNumber;
    },
  };

  try {
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
        if (await deps.hasActiveHand(closeG.id)) {
          console.log(
            `[TOURNAMENT] Merge: wait only closing table ${closeG.tableNumber} — destination tables keep playing`
          );
          if (io) await emitConsolidationWaitToGames(waitCloseIds, tournamentId, io);
          await waitForGameIdsToFinishHands(waitCloseIds, waitDeps);
        }
        await new Promise((r) => setTimeout(r, 2000));

        if (await deps.hasActiveHand(closeG.id)) {
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

          const nextFreeSeat = (d) => {
            const taken = new Set(d.rows.map((p) => p.seatNumber));
            let s = 1;
            while (s <= seatsPerTable && taken.has(s)) s++;
            if (s > seatsPerTable) {
              throw new Error(`[TOURNAMENT] No seat on table ${d.tableNumber}`);
            }
            return s;
          };

          const movers = await tx.player.findMany({
            where: { gameId: closeG.id, ...NOT_ELIMINATED },
          });
          const closeRow = await tx.game.findUnique({
            where: { id: closeG.id },
            select: { pot: true, tableNumber: true },
          });
          const orphanPot = closeRow?.pot ?? 0;

          if (orphanPot > 0 && movers.length > 0) {
            const first = movers[0];
            await tx.player.update({
              where: { id: first.id },
              data: { chips: (first.chips ?? 0) + orphanPot },
            });
            console.log(
              `[TOURNAMENT] Orphan pot ${orphanPot} from table ${closeG.tableNumber} → player ${first.id}`
            );
          } else if (orphanPot > 0) {
            console.error(
              `[TOURNAMENT] Orphan pot ${orphanPot} on table ${closeG.tableNumber} but no players to credit`
            );
          }

          for (const p of movers) {
            const dst = pickDest();
            const seat = nextFreeSeat(dst);
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
              `[TOURNAMENT] Consolidation move: user ${p.userId} table ${closeG.tableNumber} → table ${dst.tableNumber} seat ${seat}`
            );
          }

          await tx.game.update({
            where: { id: closeG.id },
            data: { status: "COMPLETED", pot: 0 },
          });
          console.log(
            `[TOURNAMENT] Closed game ${closeG.id} (table ${closeG.tableNumber}) after migrating ${movers.length} player(s)`
          );
        });

        try {
          deps.clearAllStateForGames([closeG.id]);
          const uniqueDest = [...new Set(touchedDestIds)];
          for (const did of uniqueDest) {
            if (!(await deps.hasActiveHand(did))) {
              deps.clearAllStateForGames([did]);
            }
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
            include: { players: { where: NOT_ELIMINATED } },
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

    const totalPlayersLive = games.reduce(
      (s, g) => s + (g.players?.length ?? 0),
      0
    );
    if (totalPlayersLive === 0) {
      console.log(`[TOURNAMENT] No players remaining, skipping redistribution`);
      return games;
    }

    const countsLive = games
      .map((g) => g.players?.length ?? 0)
      .filter((c) => c > 0);
    const maxLive = countsLive.length ? Math.max(...countsLive) : 0;
    const minLive = countsLive.length ? Math.min(...countsLive) : 0;
    const spreadLive = maxLive - minLive;

    console.log(
      `[TOURNAMENT] Live counts: ${games
        .map((g) => `${g.tableNumber}:${g.players?.length ?? 0}`)
        .join(", ")} — spread ${spreadLive}`
    );

    if (spreadLive > 1) {
      let balanceMoves = 0;
      while (balanceMoves < MAX_BALANCE_MOVES_PER_RUN) {
        games = await prisma.game.findMany({
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

        const nonempty = games.filter((g) => (g.players?.length ?? 0) > 0);
        if (nonempty.length < 2) break;

        const sz = nonempty.map((g) => ({ g, n: g.players.length }));
        const mx = Math.max(...sz.map((s) => s.n));
        const mn = Math.min(...sz.map((s) => s.n));
        if (mx - mn <= 1) break;

        const srcGame = sz
          .filter((s) => s.n === mx)
          .sort((a, b) => b.g.tableNumber - a.g.tableNumber)[0].g;
        const dstGame = sz
          .filter((s) => s.n === mn)
          .sort((a, b) => a.g.tableNumber - b.g.tableNumber)[0].g;

        if (srcGame.id === dstGame.id) break;

        const waitSrc = [srcGame.id];
        registerConsolidationWait(tournamentId, waitSrc);
        let progressed = false;
        try {
          const io = deps.getIO();
          if (await deps.hasActiveHand(srcGame.id)) {
            console.log(
              `[TOURNAMENT] Balance: wait only table ${srcGame.tableNumber} (largest); table ${dstGame.tableNumber} keeps playing`
            );
            if (io) await emitConsolidationWaitToGames(waitSrc, tournamentId, io);
            await waitForGameIdsToFinishHands(waitSrc, waitDeps);
          }
          await new Promise((r) => setTimeout(r, 1500));

          if (await deps.hasActiveHand(srcGame.id)) {
            console.log(
              `[TOURNAMENT] Balance: source table ${srcGame.tableNumber} still in hand — stop for this run`
            );
            break;
          }

          const srcPotRow = await prisma.game.findUnique({
            where: { id: srcGame.id },
            select: { pot: true, tableNumber: true },
          });
          if ((srcPotRow?.pot ?? 0) > 0) {
            console.warn(
              `[TOURNAMENT] Balance: source table ${srcGame.tableNumber} DB pot ${srcPotRow.pot} — skip`
            );
            break;
          }

          await prisma.$transaction(async (tx) => {
            const gs = await tx.game.findMany({
              where: { tournamentId, status: "ACTIVE" },
              include: {
                players: {
                  where: NOT_ELIMINATED,
                  orderBy: { seatNumber: "asc" },
                },
              },
              orderBy: { tableNumber: "asc" },
            });
            const srcRow = gs.find((g) => g.id === srcGame.id);
            const dstRow = gs.find((g) => g.id === dstGame.id);
            if (!srcRow?.players?.length || !dstRow) {
              throw new Error("[TOURNAMENT] Balance: missing src/dst in transaction");
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
              throw new Error(
                `[TOURNAMENT] Table ${dstRow.tableNumber} full (${dstAllSeats.length}/${seatsPerTable})`
              );
            }
            const taken = new Set(dstAllSeats.map((p) => p.seatNumber));
            let seat = 1;
            while (seat <= seatsPerTable && taken.has(seat)) seat++;
            if (seat > seatsPerTable) {
              throw new Error(
                `[TOURNAMENT] No free seat on table ${dstRow.tableNumber}`
              );
            }

            const mover = srcRow.players[0];
            await tx.player.update({
              where: { id: mover.id },
              data: { gameId: dstRow.id, seatNumber: seat },
            });
            console.log(
              `[TOURNAMENT] Balance: moved user ${mover.userId} table ${srcRow.tableNumber} → ${dstRow.tableNumber} seat ${seat}`
            );
          });

          try {
            deps.clearAllStateForGames([srcGame.id]);
            if (!(await deps.hasActiveHand(dstGame.id))) {
              deps.clearAllStateForGames([dstGame.id]);
            }
          } catch (e) {
            console.warn("[TOURNAMENT] Balance clear state:", e?.message);
          }

          const ioPush = deps.getIO();
          if (ioPush) await emitRoomsGameState([srcGame.id, dstGame.id], ioPush);

          if (ioPush) {
            for (const gid of [srcGame.id, dstGame.id]) {
              const g = await prisma.game.findUnique({
                where: { id: gid },
                include: { players: { where: NOT_ELIMINATED } },
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
          unregisterConsolidationWait(tournamentId, waitSrc);
        }

        if (!progressed) break;
      }
    } else {
      console.log(
        `[TOURNAMENT] Spread ≤ 1 — no player moves (seats unchanged except closed tables)`
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

    const playerCounts = updatedGames.map((g) => g.players.length);
    const minPlayers = Math.min(...playerCounts);
    const maxPlayers = Math.max(...playerCounts);

    console.log(
      `[TOURNAMENT] Rebalancing complete. Player counts per table:`,
      playerCounts
    );
    console.log(
      `[TOURNAMENT] Min: ${minPlayers}, Max: ${maxPlayers}, Difference: ${maxPlayers - minPlayers}`
    );

    if (maxPlayers - minPlayers > 1) {
      console.warn(
        `[TOURNAMENT] WARNING: Tables are not balanced! Max difference is ${maxPlayers - minPlayers}`
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
      if (io) {
        let started = 0;
        for (const g of updatedGames) {
          if (
            g.players.length >= 2 &&
            !(await deps.hasActiveHand(g.id))
          ) {
            try {
              await deps.startHandForGame(g.id, io);
              started++;
              console.log(
                `[TOURNAMENT] Started hand for table ${g.tableNumber} after rebalancing (${g.players.length} players)`
              );
            } catch (err) {
              console.error(
                `[TOURNAMENT] Error starting hand for table ${g.tableNumber}:`,
                err?.message
              );
            }
          }
        }
        if (started > 0) {
          io.emit("consolidation-complete", { tournamentId });
        }
      }
    } catch (e) {
      console.warn(
        "[TOURNAMENT] Could not start hands after rebalancing:",
        e?.message
      );
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
