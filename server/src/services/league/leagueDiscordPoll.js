import { prisma } from "../../config/database.js";
import { postTournamentEmbed } from "../../discord/bot.js";

const POLL_MS = 15000;

let intervalId = null;
let leagueDiscordTickInFlight = false;
let leagueDiscordBackoffUntilMs = 0;

function isPrismaPressureError(err) {
  const msg = `${err?.message ?? err ?? ""}`;
  return (
    msg.includes("connection pool") ||
    msg.includes("PrismaClientKnownRequestError") ||
    msg.includes("Can't reach database server") ||
    msg.includes("Can't reach database")
  );
}

/**
 * Post registration embeds at registrationOpensAt (league legs: T-1h before start).
 * TournamentPost rows exist with messageId null until this runs.
 */
export function startLeagueDiscordPoll() {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    const now = Date.now();
    if (leagueDiscordTickInFlight) return;
    if (now < leagueDiscordBackoffUntilMs) return;
    leagueDiscordTickInFlight = true;
    try {
      await runLeagueDiscordTick();
    } catch (err) {
      console.error("[LEAGUE] Discord poll error:", err);
      if (isPrismaPressureError(err)) {
        leagueDiscordBackoffUntilMs = Date.now() + 30000;
      }
    } finally {
      leagueDiscordTickInFlight = false;
    }
  }, POLL_MS);
  console.log(`[LEAGUE] Registration-open poll every ${POLL_MS / 1000}s (post embed at registrationOpensAt)`);
  runLeagueDiscordTick().catch((err) =>
    console.error("[LEAGUE] Discord poll initial tick:", err)
  );
}

async function runLeagueDiscordTick() {
  const now = Date.now();

  const candidates = await prisma.tournament.findMany({
    where: {
      leagueGames: { some: {} },
      registrationOpensAt: { not: null, lte: new Date(now) },
      status: { in: ["SCHEDULED", "REGISTERING"] },
      posts: { some: { messageId: null } },
    },
    include: {
      posts: { include: { server: true } },
    },
  });

  for (const tournament of candidates) {
    const opensAt = tournament.registrationOpensAt
      ? new Date(tournament.registrationOpensAt).getTime()
      : 0;
    if (now < opensAt) continue;

    const serverDiscordIds = (tournament.posts || [])
      .map((p) => p.server?.serverId)
      .filter(Boolean);
    if (serverDiscordIds.length === 0) continue;

    try {
      await postTournamentEmbed(tournament, serverDiscordIds);
    } catch (e) {
      console.error(`[LEAGUE] postTournamentEmbed failed ${tournament.id}:`, e?.message || e);
    }

    if (tournament.status === "SCHEDULED") {
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: { status: "REGISTERING" },
      });
    }
  }
}
