import dotenv from "dotenv";
import { app, server, io, PORT } from "./config/server.js";
import { connectRedis, redisClient } from "./config/redis.js";

dotenv.config();

async function listenFirst() {
  const host = process.env.LISTEN_HOST || "0.0.0.0";
  const port =
    Number(process.env.PORT) ||
    (process.env.NODE_ENV === "production" ? 8080 : Number(PORT) || 3000);
  await new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.log(`BUX Poker server listening on ${host}:${port}`);
      resolve();
    });
    server.once("error", reject);
  });

  if (redisClient) {
    connectRedis().catch((err) => {
      console.warn("[REDIS] connect failed:", err?.message);
    });
  }

  const { ensureDiscordBotOnlineLoop, isDiscordBotLoopEnabled } = await import(
    "./discord/botLoop.js"
  );
  if (isDiscordBotLoopEnabled()) {
    void ensureDiscordBotOnlineLoop();
  } else {
    console.warn(
      "[DISCORD BOT] Loop disabled (DISCORD_BOT_ENABLED=false). No gateway login on this process."
    );
  }
}

async function startBackgroundPolls() {
  const [
    { TournamentEngine, startScheduledStartPoll, startIdleTablesPoll, resumeScheduledStartTimersForSeatedTournaments, startTournamentAutomationPoll },
    { startLeagueDiscordPoll },
    { resumeBlindLevelTimersForRunningTournaments },
    { getIO },
    { startPrizeExpiryPoll },
  ] = await Promise.all([
    import("./services/TournamentEngine.js"),
    import("./services/league/leagueDiscordPoll.js"),
    import("./services/tournament/blindTimer.js"),
    import("./modules/poker/tableState.js"),
    import("./services/prizes/prizeExpiryPoll.js"),
  ]);

  resumeBlindLevelTimersForRunningTournaments({ getIO }).catch((err) =>
    console.error("[TOURNAMENT] resumeBlindLevelTimersForRunningTournaments:", err)
  );

  const tournamentPollEngine = new TournamentEngine();
  startScheduledStartPoll(tournamentPollEngine);
  startIdleTablesPoll(tournamentPollEngine);
  resumeScheduledStartTimersForSeatedTournaments(tournamentPollEngine).catch((err) =>
    console.error("[TOURNAMENT] resumeScheduledStartTimersForSeatedTournaments:", err)
  );
  startTournamentAutomationPoll(tournamentPollEngine);
  startLeagueDiscordPoll();
  startPrizeExpiryPoll();
}

async function bootstrap() {
  await listenFirst();
  const { registerSocketHandlers } = await import("./modules/socket-handlers/index.js");
  registerSocketHandlers(io);
  try {
    await startBackgroundPolls();
  } catch (err) {
    console.error("[BOOT] Background polls failed (HTTP still listening):", err);
  }
}

bootstrap().catch((err) => {
  console.error("[BOOT] Fatal (listen failed):", err);
  process.exit(1);
});
