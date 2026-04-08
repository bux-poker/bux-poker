import { prisma } from "../../config/database.js";
import { tableState } from "../../modules/poker/tableState.js";
import { awardStalePotAndZeroGame } from "./stalePotRecovery.js";
import { tryAdvanceBlindsIfDue } from "./blindLevels.js";
import { isGameConsolidationWaiting } from "./consolidateTables.js";

/** Slightly above human turn timer (20s) so recovery runs if auto-action path failed. */
const STUCK_THRESHOLD_MS = 23000;
const IDLE_POLL_INTERVAL_MS = 15000;

let idleTablesPollInterval = null;
let idleTablesPollInFlight = false;

/**
 * Start the poll that recovers idle/stuck tables and triggers consolidation when needed.
 * @param {{ consolidateTables: (tournamentId: string) => Promise<void> }} engine - object with consolidateTables method
 */
export function startIdleTablesPoll(engine) {
  if (idleTablesPollInterval) return;
  idleTablesPollInterval = setInterval(async () => {
    if (idleTablesPollInFlight) {
      console.log("[TOURNAMENT] Idle poll skipped: previous tick still running");
      return;
    }
    idleTablesPollInFlight = true;
    const { startHandForGame, hasActiveHand, forceStuckPlayerToAct, getIO, getTurnStartedAt, clearAllStateForGames } = await import("../../modules/socket-handlers/pokerHandler.js");
    const socketIO = getIO();
    const now = Date.now();
    try {
      const running = await prisma.tournament.findMany({
        where: { status: "RUNNING" },
        select: { id: true, seatsPerTable: true }
      });
      for (const t of running) {
        let blindAdvance = { advanced: false, waiting: false };
        // Backup blind advancement: wall clock vs DB (covers lost timers after deploy / missed ticks).
        try {
          blindAdvance = (await tryAdvanceBlindsIfDue(t.id, socketIO ?? null, {
            emitDealerMessage: !!socketIO,
          })) ?? { advanced: false, waiting: false };
        } catch (blindErr) {
          console.warn(`[TOURNAMENT] Idle poll blind sync failed for ${t.id}:`, blindErr?.message);
        }

        if (!socketIO) continue;

        const seatsPerTable = t.seatsPerTable ?? 9;
        // Count every non-eliminated player (incl. 0-chip all-in); chips>0 undercounted tables & blocked consolidation.
        const games = await prisma.game.findMany({
          where: { tournamentId: t.id, status: "ACTIVE" },
          include: {
            players: {
              where: { status: { not: "ELIMINATED" } },
              select: { id: true }
            }
          }
        });
        const totalCount = games.reduce((sum, g) => sum + (g.players?.length ?? 0), 0);
        const tablesNeeded = Math.max(1, Math.ceil(totalCount / seatsPerTable));
        const counts = games.map((g) => g.players?.length ?? 0).filter((c) => c > 0);
        const spread = counts.length >= 2 ? Math.max(...counts) - Math.min(...counts) : 0;
        const maxSpread = 1;
        const needsConsolidation = games.length > tablesNeeded || spread > maxSpread;
        /** Avoid starting new hands right before a merge; still run stuck-hand recovery below. */
        const skipStartHandForConsolidation = needsConsolidation && totalCount >= 2;
        for (const game of games) {
          if (game.players.length === 0) {
            if (hasActiveHand(game.id)) continue;
            await prisma.game.update({ where: { id: game.id }, data: { status: "COMPLETED", pot: 0 } });
            console.log(`[TOURNAMENT] Closed empty table ${game.tableNumber} (game ${game.id})`);
            continue;
          }
          if (game.players.length < 2) {
            // IMPORTANT: in heads-up all-in, one player's DB chips can be 0 while the hand is still active.
            // In that state, this query returns only one chip-positive player; clearing state here would
            // kill the live hand and leave the table stuck.
            const handActive = hasActiveHand(game.id);
            if (handActive || (game.pot ?? 0) > 0) {
              console.log(
                `[TOURNAMENT] Idle poll: preserving state for short-handed table ${game.tableNumber} (game ${game.id}) because hand is still settling (active=${handActive}, pot=${game.pot ?? 0})`
              );
              continue;
            }
            // Truly idle single-player table: clear stale state so future consolidation/start logic is unblocked.
            clearAllStateForGames([game.id]);
            continue;
          }

          // NEVER zero DB pot while this process still has a live hand in tableState.
          // Render logs showed mid-hand "STALE POT BUG" wipes: DB pot > 0 during FLOP betting
          // but a race/desync made hasActiveHand false briefly, or ordering ran recovery before
          // checking hand — nuking chips and confusing turn order for real players.
          if ((game.pot ?? 0) > 0 && !hasActiveHand(game.id)) {
            if (!tableState.has(game.id)) {
              // Another Fly machine may hold in-memory state for this game; do not touch DB pot here.
              continue;
            }
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
            const turnStarted = getTurnStartedAt(game.id);
            if (turnStarted <= 0) {
              // Recovery path: hand exists but no tracked turn start (e.g. stale state with null turn).
              try {
                const ok = await forceStuckPlayerToAct(game.id, socketIO);
                if (ok) {
                  console.log(`[TOURNAMENT] Idle poll: recovered no-turn active hand at table ${game.tableNumber} (game ${game.id})`);
                }
              } catch (err) {
                console.error(`[TOURNAMENT] No-turn recovery failed for table ${game.tableNumber}:`, err?.message);
              }
            } else if (now - turnStarted >= STUCK_THRESHOLD_MS) {
              try {
                const ok = await forceStuckPlayerToAct(game.id, socketIO);
                if (ok) {
                  console.log(`[TOURNAMENT] Idle poll: table ${game.tableNumber} (game ${game.id}) was stuck - forced player to act`);
                }
              } catch (err) {
                console.error(`[TOURNAMENT] Force-stuck failed for table ${game.tableNumber}:`, err?.message);
              }
            }
            continue;
          }
          try {
            if (skipStartHandForConsolidation) {
              continue;
            }
            const blockedBySchedule =
              !!blindAdvance?.inBreak ||
              !!blindAdvance?.waiting ||
              !!blindAdvance?.aligning;
            if (blockedBySchedule) {
              continue;
            }
            await startHandForGame(game.id, socketIO);
            if (hasActiveHand(game.id)) {
              console.log(`[TOURNAMENT] Idle-table recovery: started hand for game ${game.id} (table ${game.tableNumber}) with pot=0`);
            } else {
              console.log(`[TOURNAMENT] Idle-table recovery: no hand started for game ${game.id} (table ${game.tableNumber}) - blocked by break/sync/wait conditions`);
            }
          } catch (err) {
            console.error(`[TOURNAMENT] Idle-table start failed for game ${game.id}:`, err);
          }
        }
        if (needsConsolidation && totalCount >= 2) {
          console.log(
            `[TOURNAMENT] Idle poll: scheduling consolidate tournament ${t.id} — ${games.length} ACTIVE game(s), ${totalCount} players, seatsPerTable=${seatsPerTable}, tablesNeeded=${tablesNeeded}, counts=[${counts.join(",")}], spread=${spread}`
          );
          void engine.consolidateTables(t.id).catch((err) => {
            const code = err?.code ?? "";
            const meta = err?.meta != null ? JSON.stringify(err.meta) : "";
            console.error(
              "[TOURNAMENT] Idle-poll consolidation failed:",
              err?.message || code || String(err),
              meta
            );
          });
        }
      }
    } catch (err) {
      console.error("[TOURNAMENT] Idle tables poll error:", err);
    } finally {
      idleTablesPollInFlight = false;
    }
  }, IDLE_POLL_INTERVAL_MS);
  console.log(`[TOURNAMENT] Idle tables poll running every ${IDLE_POLL_INTERVAL_MS / 1000}s (stuck-table recovery after ${STUCK_THRESHOLD_MS / 1000}s)`);
}
