import { prisma } from "../../config/database.js";
import { awardStalePotAndZeroGame } from "./stalePotRecovery.js";

const STUCK_THRESHOLD_MS = 45000;
const IDLE_POLL_INTERVAL_MS = 15000;

let idleTablesPollInterval = null;

/**
 * Start the poll that recovers idle/stuck tables and triggers consolidation when needed.
 * @param {{ consolidateTables: (tournamentId: string) => Promise<void> }} engine - object with consolidateTables method
 */
export function startIdleTablesPoll(engine) {
  if (idleTablesPollInterval) return;
  idleTablesPollInterval = setInterval(async () => {
    const { startHandForGame, hasActiveHand, forceStuckPlayerToAct, getIO, getTurnStartedAt, clearAllStateForGames } = await import("../../modules/socket-handlers/pokerHandler.js");
    const socketIO = getIO();
    if (!socketIO) return;
    const now = Date.now();
    try {
      const running = await prisma.tournament.findMany({
        where: { status: "RUNNING" },
        select: { id: true, seatsPerTable: true }
      });
      for (const t of running) {
        const seatsPerTable = t.seatsPerTable ?? 9;
        const games = await prisma.game.findMany({
          where: { tournamentId: t.id, status: "ACTIVE" },
          include: {
            players: {
              where: { status: { not: "ELIMINATED" }, chips: { gt: 0 } },
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
        if (needsConsolidation && totalCount >= 2) {
          try {
            console.log(`[TOURNAMENT] Idle poll: uneven tables (${counts.join(",")}), triggering consolidation`);
            await engine.consolidateTables(t.id);
          } catch (err) {
            console.error("[TOURNAMENT] Idle-poll consolidation failed:", err?.message);
          }
          continue;
        }
        for (const game of games) {
          if (game.players.length === 0) {
            if (hasActiveHand(game.id)) continue;
            await prisma.game.update({ where: { id: game.id }, data: { status: "COMPLETED", pot: 0 } });
            console.log(`[TOURNAMENT] Closed empty table ${game.tableNumber} (game ${game.id})`);
            continue;
          }
          if (game.players.length < 2) {
            // Single-player tables should not retain stale in-memory hand state;
            // this can block consolidation and leave players stranded.
            clearAllStateForGames([game.id]);
            continue;
          }

          if ((game.pot ?? 0) > 0) {
            console.warn(
              `[TOURNAMENT] Idle-table recovery: awarding stale pot=${game.pot} to players at game ${game.id} (table ${game.tableNumber}) then zeroing so hand can start`
            );
            await awardStalePotAndZeroGame(game.id, game.pot);
            game.pot = 0;
          }
          if (hasActiveHand(game.id)) {
            const turnStarted = getTurnStartedAt(game.id);
            if (turnStarted > 0 && now - turnStarted >= STUCK_THRESHOLD_MS) {
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
            await startHandForGame(game.id, socketIO);
            console.log(`[TOURNAMENT] Idle-table recovery: started hand for game ${game.id} (table ${game.tableNumber}) with pot=0`);
          } catch (err) {
            console.error(`[TOURNAMENT] Idle-table start failed for game ${game.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("[TOURNAMENT] Idle tables poll error:", err);
    }
  }, IDLE_POLL_INTERVAL_MS);
  console.log(`[TOURNAMENT] Idle tables poll running every ${IDLE_POLL_INTERVAL_MS / 1000}s (stuck-table recovery after ${STUCK_THRESHOLD_MS / 1000}s)`);
}
