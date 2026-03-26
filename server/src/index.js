import dotenv from "dotenv";
import { app, server, io, PORT } from "./config/server.js";
import { registerSocketHandlers } from "./modules/socket-handlers/index.js";
import { initializeDiscordBot } from "./discord/bot.js";
import {
  TournamentEngine,
  startScheduledStartPoll,
  startIdleTablesPoll,
  resumeScheduledStartTimersForSeatedTournaments,
  startTournamentAutomationPoll,
} from "./services/TournamentEngine.js";
import { startLeagueDiscordPoll } from "./services/league/leagueDiscordPoll.js";
import { connectRedis } from "./config/redis.js";
import { resumeBlindLevelTimersForRunningTournaments } from "./services/tournament/blindTimer.js";
import { getIO } from "./modules/poker/tableState.js";

dotenv.config();

registerSocketHandlers(io);

// Blind timers live in memory — restore them after deploy so levels keep advancing.
resumeBlindLevelTimersForRunningTournaments({ getIO }).catch((err) =>
  console.error("[TOURNAMENT] resumeBlindLevelTimersForRunningTournaments:", err)
);

// Single engine instance for background polls (admin routes use their own engine; behavior is stateless)
const tournamentPollEngine = new TournamentEngine();

// Poll for tournaments whose scheduled start time has passed (survives process restart)
startScheduledStartPoll(tournamentPollEngine);
startIdleTablesPoll(tournamentPollEngine);
resumeScheduledStartTimersForSeatedTournaments(tournamentPollEngine).catch((err) =>
  console.error("[TOURNAMENT] resumeScheduledStartTimersForSeatedTournaments:", err)
);
// At (startTime - 2m): close registration, seat players, arm countdown to startTime
startTournamentAutomationPoll(tournamentPollEngine);
startLeagueDiscordPoll();
const DISCORD_INIT_TIMEOUT_MS = Number(process.env.DISCORD_INIT_TIMEOUT_MS || 12000);
const DISCORD_INIT_RETRY_MS = Number(process.env.DISCORD_INIT_RETRY_MS || 30000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDiscordBotOnlineLoop() {
  while (true) {
    try {
      const bot = await Promise.race([
        initializeDiscordBot(),
        sleep(DISCORD_INIT_TIMEOUT_MS).then(() => null),
      ]);
      if (bot) {
        console.log("[DISCORD BOT] Online");
        return;
      }
      console.warn(
        `[DISCORD BOT] Init did not complete within ${DISCORD_INIT_TIMEOUT_MS}ms; retrying in ${DISCORD_INIT_RETRY_MS}ms`
      );
    } catch (err) {
      console.error("[DISCORD BOT] Failed to initialize:", err);
    }
    await sleep(DISCORD_INIT_RETRY_MS);
  }
}

async function start() {
  if (process.env.REDIS_URL) {
    await connectRedis().catch((err) => {
      console.warn("[REDIS] Session store unavailable, using memory:", err?.message);
    });
  }
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`BUX Poker server listening on port ${PORT}`);
  });

  // Never block port binding; keep retrying Discord init until bot is online.
  void ensureDiscordBotOnlineLoop();
}
start();

