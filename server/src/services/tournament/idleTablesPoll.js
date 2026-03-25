import { prisma } from "../../config/database.js";
import { awardStalePotAndZeroGame } from "./stalePotRecovery.js";
import { tryAdvanceBlindsIfDue } from "./blindLevels.js";
import { isGameConsolidationWaiting } from "./consolidateTables.js";

const STUCK_THRESHOLD_MS = 45000;
const IDLE_POLL_INTERVAL_MS = 15000;

let recoveryPollInterval = null;
let consolidationPollInterval = null;
let recoveryPollInFlight = false;
let consolidationPollInFlight = false;

/**
 * Table recovery: stuck hands, stale DB pots, starting idle tables.
 * Runs on its own timer so long-running consolidation cannot starve it (Render logs showed
 * "Idle poll skipped: previous tick still running" for minutes while consolidateTables waited).
 */
async function runRecoveryPass() {
  const {
    startHandForGame,
    hasActiveHand,
    forceStuckPlayerToAct,
    getIO,
    getTurnStartedAt,
    clearAllStateForGames,
    ensureTurnTimerIfMissing,
  } = await import("../../modules/socket-handlers/pokerHandler.js");
  const socketIO = getIO();
  const now = Date.now();
  const running = await prisma.tournament.findMany({
    where: { status: "RUNNING" },
    select: { id: true, seatsPerTable: true },
  });
  for (const t of running) {
    let blindAdvance = { advanced: false, waiting: false };
    try {
      blindAdvance =
        (await tryAdvanceBlindsIfDue(t.id, socketIO ?? null, {
          emitDealerMessage: !!socketIO,
        })) ?? { advanced: false, waiting: false };
    } catch (blindErr) {
      console.warn(`[TOURNAMENT] Idle poll blind sync failed for ${t.id}:`, blindErr?.message);
    }

    if (!socketIO) continue;

    const games = await prisma.game.findMany({
      where: { tournamentId: t.id, status: "ACTIVE" },
      include: {
        players: {
          where: { status: { not: "ELIMINATED" } },
          select: { id: true },
        },
      },
    });

    for (const game of games) {
      if (game.players.length === 0) {
        if (hasActiveHand(game.id)) continue;
        await prisma.game.update({ where: { id: game.id }, data: { status: "COMPLETED", pot: 0 } });
        console.log(`[TOURNAMENT] Closed empty table ${game.tableNumber} (game ${game.id})`);
        continue;
      }
      if (game.players.length < 2) {
        const handActive = hasActiveHand(game.id);
        if (handActive || (game.pot ?? 0) > 0) {
          console.log(
            `[TOURNAMENT] Idle poll: preserving state for short-handed table ${game.tableNumber} (game ${game.id}) because hand is still settling (active=${handActive}, pot=${game.pot ?? 0})`
          );
          continue;
        }
        clearAllStateForGames([game.id]);
        continue;
      }

      if ((game.pot ?? 0) > 0 && !hasActiveHand(game.id)) {
        if (isGameConsolidationWaiting(game.id)) {
          console.log(
            `[TOURNAMENT] Skipping stale-pot recovery for game ${game.id} — consolidation wait active for this table`
          );
          continue;
        }
        console.warn(
          `[TOURNAMENT] Idle-table recovery: zeroing stale DB pot=${game.pot} at game ${game.id} (table ${game.tableNumber}) — no active in-memory hand`
        );
        await awardStalePotAndZeroGame(game.id, game.pot);
        game.pot = 0;
      }

      if (hasActiveHand(game.id)) {
        ensureTurnTimerIfMissing(game.id, socketIO);
        const turnStarted = getTurnStartedAt(game.id);
        if (turnStarted <= 0) {
          try {
            const ok = await forceStuckPlayerToAct(game.id, socketIO);
            if (ok) {
              console.log(
                `[TOURNAMENT] Idle poll: recovered no-turn active hand at table ${game.tableNumber} (game ${game.id})`
              );
            }
          } catch (err) {
            console.error(`[TOURNAMENT] No-turn recovery failed for table ${game.tableNumber}:`, err?.message);
          }
        } else if (now - turnStarted >= STUCK_THRESHOLD_MS) {
          try {
            const ok = await forceStuckPlayerToAct(game.id, socketIO);
            if (ok) {
              console.log(
                `[TOURNAMENT] Idle poll: table ${game.tableNumber} (game ${game.id}) was stuck - forced player to act`
              );
            }
          } catch (err) {
            console.error(`[TOURNAMENT] Force-stuck failed for table ${game.tableNumber}:`, err?.message);
          }
        }
        continue;
      }
      try {
        const blockedBySchedule =
          !!blindAdvance?.inBreak || !!blindAdvance?.waiting || !!blindAdvance?.aligning;
        if (blockedBySchedule) {
          continue;
        }
        await startHandForGame(game.id, socketIO);
        if (hasActiveHand(game.id)) {
          console.log(
            `[TOURNAMENT] Idle-table recovery: started hand for game ${game.id} (table ${game.tableNumber}) with pot=0`
          );
        } else {
          console.log(
            `[TOURNAMENT] Idle-table recovery: no hand started for game ${game.id} (table ${game.tableNumber}) - blocked by break/sync/wait conditions`
          );
        }
      } catch (err) {
        console.error(`[TOURNAMENT] Idle-table start failed for game ${game.id}:`, err);
      }
    }
  }
}

/**
 * Consolidation only — can block this interval for a long time without blocking recovery.
 */
async function runConsolidationPass(engine) {
  const running = await prisma.tournament.findMany({
    where: { status: "RUNNING" },
    select: { id: true, seatsPerTable: true },
  });
  for (const t of running) {
    const seatsPerTable = t.seatsPerTable ?? 9;
    const games = await prisma.game.findMany({
      where: { tournamentId: t.id, status: "ACTIVE" },
      include: {
        players: {
          where: { status: { not: "ELIMINATED" } },
          select: { id: true },
        },
      },
    });
    const totalCount = games.reduce((sum, g) => sum + (g.players?.length ?? 0), 0);
    const tablesNeeded = Math.max(1, Math.ceil(totalCount / seatsPerTable));
    const counts = games.map((g) => g.players?.length ?? 0).filter((c) => c > 0);
    const spread = counts.length >= 2 ? Math.max(...counts) - Math.min(...counts) : 0;
    const maxSpread = 1;
    const needsConsolidation = games.length > tablesNeeded || spread > maxSpread;
    if (needsConsolidation && totalCount >= 2) {
      try {
        console.log(
          `[TOURNAMENT] Idle poll: consolidate tournament ${t.id} — ${games.length} ACTIVE game(s), ${totalCount} players, seatsPerTable=${seatsPerTable}, tablesNeeded=${tablesNeeded}, counts=[${counts.join(",")}], spread=${spread}`
        );
        await engine.consolidateTables(t.id);
      } catch (err) {
        const code = err?.code ?? "";
        const meta = err?.meta != null ? JSON.stringify(err.meta) : "";
        console.error(
          "[TOURNAMENT] Idle-poll consolidation failed:",
          err?.message || code || String(err),
          meta
        );
      }
    }
  }
}

/**
 * Start polls that recover idle/stuck tables and trigger consolidation when needed.
 * Recovery and consolidation use separate timers so one slow path does not block the other.
 * @param {{ consolidateTables: (tournamentId: string) => Promise<void> }} engine - object with consolidateTables method
 */
export function startIdleTablesPoll(engine) {
  if (recoveryPollInterval) return;

  recoveryPollInterval = setInterval(async () => {
    if (recoveryPollInFlight) {
      console.log("[TOURNAMENT] Recovery poll skipped: previous tick still running");
      return;
    }
    recoveryPollInFlight = true;
    try {
      await runRecoveryPass();
    } catch (err) {
      console.error("[TOURNAMENT] Recovery tables poll error:", err);
    } finally {
      recoveryPollInFlight = false;
    }
  }, IDLE_POLL_INTERVAL_MS);

  consolidationPollInterval = setInterval(async () => {
    if (consolidationPollInFlight) {
      console.log("[TOURNAMENT] Consolidation poll skipped: previous tick still running");
      return;
    }
    consolidationPollInFlight = true;
    try {
      await runConsolidationPass(engine);
    } catch (err) {
      console.error("[TOURNAMENT] Consolidation poll error:", err);
    } finally {
      consolidationPollInFlight = false;
    }
  }, IDLE_POLL_INTERVAL_MS);

  console.log(
    `[TOURNAMENT] Idle tables poll (recovery + consolidation) every ${IDLE_POLL_INTERVAL_MS / 1000}s (stuck-table recovery after ${STUCK_THRESHOLD_MS / 1000}s)`
  );
}
