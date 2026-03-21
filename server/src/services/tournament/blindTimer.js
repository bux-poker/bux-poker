import { prisma } from "../../config/database.js";
import { tryAdvanceBlindsIfDue } from "./blindLevels.js";

const blindTimers = new Map(); // tournamentId -> intervalId

/**
 * After process restart, blind timers are lost. Resume them for all RUNNING tournaments.
 * @param {{ getIO: () => object }} deps
 */
export async function resumeBlindLevelTimersForRunningTournaments(deps) {
  const { getIO } = deps;
  try {
    const running = await prisma.tournament.findMany({
      where: { status: "RUNNING", startedAt: { not: null } },
      select: { id: true }
    });
    const io = getIO();
    for (const t of running) {
      await tryAdvanceBlindsIfDue(t.id, io, { emitDealerMessage: !!io });
      startBlindLevelTimer(t.id, deps);
      console.log(`[TOURNAMENT] Resumed blind level timer for tournament ${t.id}`);
    }
  } catch (e) {
    console.error(
      "[TOURNAMENT] Failed to resume blind timers:",
      e?.code ? `${e.code} ${e?.message}` : e?.message
    );
  }
}

/**
 * Start the blind level progression timer for a running tournament (check every 60s).
 * @param {string} tournamentId
 * @param {{ getIO: () => object }} deps
 */
export function startBlindLevelTimer(tournamentId, deps) {
  if (blindTimers.has(tournamentId)) {
    clearInterval(blindTimers.get(tournamentId));
    blindTimers.delete(tournamentId);
  }

  const { getIO } = deps;
  console.log(`[TOURNAMENT] Blind level timer started for tournament ${tournamentId}, checking every 5 seconds`);
  const intervalId = setInterval(async () => {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId }
      });

      if (!tournament || tournament.status !== "RUNNING" || !tournament.startedAt) {
        console.log(`[TOURNAMENT] Tournament ${tournamentId} not running, clearing blind timer`);
        clearInterval(intervalId);
        blindTimers.delete(tournamentId);
        return;
      }

      const io = getIO();
      await tryAdvanceBlindsIfDue(tournamentId, io, { emitDealerMessage: true });
    } catch (err) {
      const code = err?.code;
      const msg = err?.message ?? String(err);
      console.error(
        `[TOURNAMENT] Error in blind level timer for tournament ${tournamentId}:`,
        code ? `${code} ${msg}` : msg
      );
      if (code === "P2022" || /does not exist|column/i.test(msg)) {
        console.error(
          "[TOURNAMENT] DB schema likely out of date — run `npx prisma migrate deploy` on the server DB and redeploy."
        );
      }
    }
  }, 5000);

  blindTimers.set(tournamentId, intervalId);
}
