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
 * Retry the *early notice* Discord embed (create/fund) when the first post failed.
 * Registration buttons are enabled later by the registration-open poll at T-1h.
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
    `[TOURNAMENT] Discord early-notice retry poll every ${POLL_MS / 1000}s`
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
      // Only retry early notices; T-1h first-posts are handled by registration-open poll.
      OR: [
        { registrationOpensAt: null },
        { registrationOpensAt: { gt: new Date() } },
      ],
    },
    include: {
      posts: { include: { server: true } },
      leagueGames: {
        include: {
          league: {
            select: { prizeMode: true, prizeFundingStatus: true },
          },
        },
      },
    },
  });

  for (const tournament of candidates) {
    if (!isDiscordAnnounceAllowed(tournament)) continue;

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

function isDiscordAnnounceAllowed(tournament) {
  const league = tournament.leagueGames?.[0]?.league;
  if (league) {
    if (league.prizeMode === "WALLET" && league.prizeFundingStatus !== "FUNDED") {
      return false;
    }
    return true;
  }
  if (tournament.prizeMode === "WALLET" && tournament.prizeFundingStatus !== "FUNDED") {
    return false;
  }
  return true;
}
