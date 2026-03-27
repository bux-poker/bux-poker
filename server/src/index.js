import dotenv from "dotenv";
import { app, server, io, PORT } from "./config/server.js";
import { registerSocketHandlers } from "./modules/socket-handlers/index.js";
import {
  ensureDiscordBotOnlineLoop,
  isDiscordBotLoopEnabled,
} from "./discord/botLoop.js";
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

async function start() {
  // Bind HTTP first — never await Redis before listen() or Fly health checks fail (Redis may hang if URL is wrong/unreachable).
  const host = process.env.LISTEN_HOST || "0.0.0.0";
  const port = Number(process.env.PORT) || Number(PORT) || 8080;
  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`BUX Poker server listening on ${host}:${port}`);
  });

  if (process.env.REDIS_URL) {
    connectRedis().catch((err) => {
      console.warn("[REDIS] Session store unavailable, using memory:", err?.message);
    });
  }

  // Discord gateway often fails from some cloud egress IPs (Cloudflare "Access denied"). Set DISCORD_BOT_ENABLED=false on that host and run the bot elsewhere.
  if (isDiscordBotLoopEnabled()) {
    void ensureDiscordBotOnlineLoop();
  } else {
    console.warn(
      "[DISCORD BOT] Loop disabled (DISCORD_BOT_ENABLED=false). No gateway login on this process."
    );
  }
}
start();

