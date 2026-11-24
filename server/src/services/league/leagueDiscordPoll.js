import { prisma } from "../../config/database.js";
import {
  postTournamentEmbed,
  updateTournamentEmbeds,
} from "../../discord/bot.js";

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
 * At registrationOpensAt (T-1h):
 * - If early notice already posted → update embed to enable Register
 * - If no message yet → post full embed with Register
 * Applies to standalone tournaments and league legs.
 */
export function startLeagueDiscordPoll() {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    const now = Date.now();
    if (leagueDiscordTickInFlight) return;
    if (now < leagueDiscordBackoffUntilMs) return;
    leagueDiscordTickInFlight = true;
    try {
      await runRegistrationOpenDiscordTick();
    } catch (err) {
      console.error("[DISCORD] Registration-open poll error:", err);
      if (isPrismaPressureError(err)) {
        leagueDiscordBackoffUntilMs = Date.now() + 30000;
      }
    } finally {
      leagueDiscordTickInFlight = false;
    }
  }, POLL_MS);
  console.log(
    `[DISCORD] Registration-open poll every ${POLL_MS / 1000}s (enable Register at registrationOpensAt)`
  );
  runRegistrationOpenDiscordTick().catch((err) =>
    console.error("[DISCORD] Registration-open poll initial tick:", err)
  );
}

async function runRegistrationOpenDiscordTick() {
  const now = Date.now();

  const candidates = await prisma.tournament.findMany({
    where: {
      registrationOpensAt: { not: null, lte: new Date(now) },
      status: { in: ["SCHEDULED", "REGISTERING"] },
      OR: [
        // Need the T-1h transition (enable Register on existing notice)
        { status: "SCHEDULED" },
        // Or never got a Discord message at all
        { posts: { some: { messageId: null } } },
      ],
    },
    include: {
      posts: { include: { server: true } },
      leagueGames: {
        include: {
          league: {
            select: {
              prizeMode: true,
              prizeFundingStatus: true,
            },
          },
        },
      },
    },
  });

  for (const tournament of candidates) {
    if (!isDiscordAnnounceAllowed(tournament)) continue;

    const serverDiscordIds = (tournament.posts || [])
      .map((p) => p.server?.serverId)
      .filter(Boolean);
    if (serverDiscordIds.length === 0) continue;

    const missingPosts = (tournament.posts || []).some((p) => !p.messageId);
    const hasPosted = (tournament.posts || []).some((p) => !!p.messageId);

    try {
      if (missingPosts) {
        await postTournamentEmbed(tournament, serverDiscordIds);
      } else if (hasPosted && tournament.status === "SCHEDULED") {
        // Early notice already out — refresh so Register appears.
        await updateTournamentEmbeds(tournament.id);
      }
    } catch (e) {
      console.error(
        `[DISCORD] registration-open failed ${tournament.id}:`,
        e?.message || e
      );
      continue;
    }

    if (tournament.status === "SCHEDULED") {
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: { status: "REGISTERING" },
      });
    }
  }
}

/** Skip WALLET events that are not funded yet (standalone or league). */
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
