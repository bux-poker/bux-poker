import { prisma } from "../../config/database.js";
import { cancelLeagueLegInsufficient } from "../league/cancelLeagueLegInsufficient.js";

const PRESTART_LEAD_MS = 2 * 60 * 1000;
const POLL_MS = 15000;

let automationPollInterval = null;
let automationTickInFlight = false;
let automationPollBackoffUntilMs = 0;

function isPrismaPressureError(err) {
  const msg = `${err?.message ?? err ?? ""}`;
  return (
    msg.includes("connection pool") ||
    msg.includes("PrismaClientKnownRequestError") ||
    msg.includes("Can't reach database server") ||
    msg.includes("Can't reach database")
  );
}

function preStartThresholdMs(startTime) {
  return new Date(startTime).getTime() - PRESTART_LEAD_MS;
}

/**
 * Poll: at (startTime - 2m), close registration, seat players, and arm countdown to startTime.
 * Also repairs SEATED tournaments that have games but no startScheduledAt once inside the pre-start window.
 */
export function startTournamentAutomationPoll(engine) {
  if (automationPollInterval) return;
  automationPollInterval = setInterval(async () => {
    const now = Date.now();
    if (automationTickInFlight) return;
    if (now < automationPollBackoffUntilMs) return;
    automationTickInFlight = true;
    try {
      await runTournamentAutomationTick(engine);
    } catch (err) {
      console.error("[TOURNAMENT] Automation poll tick error:", err);
      if (isPrismaPressureError(err)) {
        automationPollBackoffUntilMs = Date.now() + 30000;
      }
    } finally {
      automationTickInFlight = false;
    }
  }, POLL_MS);
  console.log(`[TOURNAMENT] Auto pre-start poll every ${POLL_MS / 1000}s (close + seat at startTime - 2m)`);
  runTournamentAutomationTick(engine).catch((err) =>
    console.error("[TOURNAMENT] Automation initial tick error:", err)
  );
}

export async function runTournamentAutomationTick(engine) {
  const now = Date.now();

  const registering = await prisma.tournament.findMany({
    where: {
      status: { in: ["REGISTERING", "SCHEDULED"] },
    },
    select: { id: true, startTime: true },
  });

  const leagueLegRows = await prisma.leagueGame.findMany({
    where: { tournamentId: { in: registering.map((x) => x.id) } },
    select: { tournamentId: true },
  });
  const leagueTournamentIds = new Set(leagueLegRows.map((r) => r.tournamentId));

  for (const t of registering) {
    if (now < preStartThresholdMs(t.startTime)) continue;

    const confirmed = await prisma.tournamentRegistration.count({
      where: { tournamentId: t.id, status: "CONFIRMED" },
    });

    if (leagueTournamentIds.has(t.id)) {
      if (confirmed < 5) {
        await cancelLeagueLegInsufficient(t.id);
        console.log(
          `[LEAGUE] Cancelled leg ${t.id}: only ${confirmed} registered (<5) at T-2m`
        );
        continue;
      }
    } else if (confirmed === 0) {
      console.log(
        `[TOURNAMENT] Auto pre-start skipped ${t.id}: no confirmed players at T-2m window`
      );
      continue;
    }

    try {
      await engine.closeRegistration(t.id);
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (/Players are already seated|already seated/i.test(msg)) {
        // Admin closed early — still need countdown
      } else if (/No registered players/i.test(msg)) {
        continue;
      } else {
        console.error(`[TOURNAMENT] Auto closeRegistration failed for ${t.id}:`, msg);
        continue;
      }
    }

    await engine.scheduleOfficialStartCountdown(t.id);
  }

  const stranded = await prisma.tournament.findMany({
    where: {
      status: "SEATED",
      startScheduledAt: null,
      startedAt: null,
    },
    select: {
      id: true,
      startTime: true,
      _count: { select: { games: true } },
    },
  });

  for (const t of stranded) {
    if (now < preStartThresholdMs(t.startTime)) continue;
    if ((t._count?.games ?? 0) < 1) continue;
    await engine.scheduleOfficialStartCountdown(t.id);
  }
}
