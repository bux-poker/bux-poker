import { prisma } from "../../config/database.js";
import { postTournamentEmbed } from "../../discord/bot.js";

const POLL_MS = 15000;

let intervalId = null;
let tournamentDiscordTickInFlight = false;
let tournamentDiscordBackoffUntilMs = 0;

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
 * Retry posting the initial "registration" Discord embed for single tournaments.
 * Unlike league legs (posted at T-1h by leagueDiscordPoll), single tournaments are
 * supposed to post immediately on create; however, Discord init/network hiccups
 * can cause the immediate attempt to be skipped. This poll fills that gap.
 * Standalone tournaments only (league legs use leagueDiscordPoll at T-1h).
 */
export function startTournamentDiscordPoll() {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    const now = Date.now();
    if (tournamentDiscordTickInFlight) return;
    if (now < tournamentDiscordBackoffUntilMs) return;
    tournamentDiscordTickInFlight = true;
    try {
      await runTournamentDiscordTick();
    } catch (err) {
      console.error("[TOURNAMENT] Tournament Discord poll error:", err);
      if (isPrismaPressureError(err)) {
        tournamentDiscordBackoffUntilMs = Date.now() + 30000;
      }
    } finally {
      tournamentDiscordTickInFlight = false;
    }
  }, POLL_MS);

  console.log(
    `[TOURNAMENT] Discord registration-post retry poll every ${POLL_MS / 1000}s`
  );
  runTournamentDiscordTick().catch((err) =>
    console.error("[TOURNAMENT] Tournament Discord poll initial tick:", err)
  );
}

async function runTournamentDiscordTick() {
  const candidates = await prisma.tournament.findMany({
    where: {
      status: { in: ["SCHEDULED", "REGISTERING"] },
      posts: { some: { messageId: null } },
      // League legs are posted at T-1h by leagueDiscordPoll only — do not post here.
      leagueGames: { none: {} },
    },
    include: {
      posts: { include: { server: true } },
    },
  });

  for (const tournament of candidates) {
    const serverDiscordIds = (tournament.posts || [])
      .filter((p) => !p.messageId)
      .map((p) => p.server?.serverId)
      .filter(Boolean);

    if (serverDiscordIds.length === 0) continue;

    try {
      await postTournamentEmbed(tournament, serverDiscordIds);
    } catch (e) {
      console.error(
        `[TOURNAMENT] postTournamentEmbed failed ${tournament.id}:`,
        e?.message || e
      );
    }
  }
}

